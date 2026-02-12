const Chat = require('./chat.model');
const Message = require('./message.model');
const { successResponse, errorResponse } = require('../../common/utils/response');

const { BASE_ABUSIVE_WORDS, CONTACT_PATTERNS } = require('../../common/constants/moderation');

// --- ROBUST MODERATION CONFIGURATION ---

// Map characters to their leetspeak/symbol equivalents
const LEET_MAP = {
    'a': '[a@4]', 'i': '[i1!|]', 'o': '[o0]', 's': '[s$5]', 'e': '[e3]', 'l': '[l1|]', 't': '[t7+]'
};

// ... (existing helper functions) ...

// Helper to compile regex for a specific word handling spacing and leetspeak
// e.g., "shit" -> "s[\W_]*h[\W_]*i[\W_]*t" (matches "s h i t", "s-h-1-t", etc.)
const buildProfanityRegex = (words) => {
    const patternString = words.map(word => {
        return word.split('').map(char => {
            const lower = char.toLowerCase();
            const leet = LEET_MAP[lower] || lower;
            // Allow arbitrary non-word characters (spaces, dots, etc) between letters
            return `${leet}[\\W_]*`;
        }).join('');
    }).join('|');
    return new RegExp(`(${patternString})`, 'i');
};

const PROFANITY_REGEX = buildProfanityRegex(BASE_ABUSIVE_WORDS);

// --- EXTERNAL MODERATION API INTEGRATION ---
// Using PurgoMalum (Free, No Auth) as primary filter for clean code integration
const checkProfanityAPI = async (text) => {
    try {
        const response = await fetch(`https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(text)}`);
        const result = await response.text();
        return result === 'true';
    } catch (error) {
        console.error('Moderation API Error (Fail Open):', error.message);
        return false; // Fail open to avoid blocking chat on API failure
    }
};


// Initiate (or get existing) chat
exports.initiateChat = async (req, res) => {
    try {
        const { recipientId, jobId } = req.body;
        const senderId = req.user.id;

        if (!recipientId || !jobId) {
            return errorResponse(res, 'Recipient ID and Job ID are required', 400);
        }

        // Check if chat exists for this job and participants
        let chat = await Chat.findOne({
            job: jobId,
            participants: { $all: [senderId, recipientId] }
        });

        if (chat) {
            chat = await Chat.findById(chat._id)
                .populate('participants', 'name profileImage role')
                .populate('job', 'job_title status');
            return successResponse(res, 'Chat retrieved successfully', chat);
        }

        // Validate Job exists
        const Job = require('../jobs/job.model');
        const job = await Job.findById(jobId);
        if (!job) {
            return errorResponse(res, 'Job not found', 404);
        }

        // Ensure user is involved in the job (Owner or Selected Worker or Applicant - simplified check for now)
        // Ideally should check if sender is owner or applicant. For now, assuming UI handles correct ID.

        // Create new chat
        const newChat = await Chat.create({
            participants: [senderId, recipientId],
            job: jobId,
            unreadCounts: {
                [senderId]: 0,
                [recipientId]: 0
            }
        });

        const populatedChat = await Chat.findById(newChat._id)
            .populate('participants', 'name profileImage role')
            .populate('job', 'job_title status');

        return successResponse(res, 'Chat initiated successfully', populatedChat, 201);
    } catch (error) {
        console.error('Error initiating chat:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Get User Chats
exports.getUserChats = async (req, res) => {
    try {
        const userId = req.user.id;
        const chats = await Chat.find({ participants: userId })
            .populate('participants', 'name profileImage role')
            .populate('job', 'job_title status')
            .sort({ lastMessageTime: -1 });

        return successResponse(res, 'Chats retrieved successfully', chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Send Message
exports.sendMessage = async (req, res) => {
    try {
        const { chatId, text, media } = req.body;
        const senderId = req.user.id;

        // Validation: Must have at least Text or Media
        if (!chatId || (!text && (!media || media.length === 0))) {
            return errorResponse(res, 'Chat ID and either text or media are required', 400);
        }

        // Validate Media Types (Professional Constraint)
        if (media && media.length > 0) {
            const allowedTypes = ['image', 'video', 'document'];
            const invalidMedia = media.find(m => !allowedTypes.includes(m.fileType));
            if (invalidMedia) {
                return errorResponse(res, 'Invalid media type. Only images, videos, and documents are allowed.', 400);
            }
            // Optional: Check URL extension (simple check)
            // const validExtensions = /\.(jpg|jpeg|png|pdf|mp4|mov)$/i;
        }

        const User = require('../users/user.model');
        const currentUser = await User.findById(senderId);

        // --- ROBUST MODERATION CHECKS (Constraint 1, 2, 6, 11) ---

        // 1. System Mute Enforcement
        if (currentUser.chatMutedUntil && new Date() < new Date(currentUser.chatMutedUntil)) {
            const minutesLeft = Math.ceil((new Date(currentUser.chatMutedUntil) - new Date()) / 60000);
            return errorResponse(res, `You are temporarily muted for ${minutesLeft} minutes due to policy violations.`, 403);
        }

        let isAbusive = false;
        let textNormalized = '';

        if (text && text.trim().length > 0) {
            const textLower = text.toLowerCase();
            textNormalized = textLower.replace(/[\s\W_]+/g, ''); // "h e l l o" -> "hello"

            // 2. Advanced Toxic Language Detection (Hybrid: API + Local Regex)
            // A. Local Regex Check (Fast, Handle custom Hi/Gu words)
            if (PROFANITY_REGEX.test(text)) {
                isAbusive = true;
            }
            // B. External API Check (Robust, handles English nuance/context better)
            else {
                // Only call API if local check passes to save bandwidth/latency
                isAbusive = await checkProfanityAPI(text);
            }
        }

        if (isAbusive) {
            // Increment Strike
            currentUser.chatStrikes = (currentUser.chatStrikes || 0) + 1;

            let warningMessage = 'Message blocked: Profanity or abusive patterns detected.';

            // 3rd Strike Rule (Strict)
            if (currentUser.chatStrikes >= 3) {
                currentUser.chatMutedUntil = new Date(Date.now() + 15 * 60000); // 15 mins mute
                currentUser.chatStrikes = 0; // Reset cycle
                warningMessage = 'Violation 3/3. You have been muted for 15 minutes due to repeated abusive language.';
            } else {
                warningMessage += ` Violation ${currentUser.chatStrikes}/3. Continued abuse will lead to a mute.`;
            }

            await currentUser.save();
            return errorResponse(res, warningMessage, 400);
        }

        // 3. Robust Rate Limiting & Burst Protection
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60000);
        const fiveSecondsAgo = new Date(now.getTime() - 5000); // Burst window

        const recentMessages = await Message.find({
            senderId,
            createdAt: { $gte: oneMinuteAgo }
        }).select('text createdAt');

        // A. Burst Limit: Max 5 messages in 5 seconds
        const burstCount = recentMessages.filter(m => m.createdAt > fiveSecondsAgo).length;
        if (burstCount >= 5) {
            currentUser.chatMutedUntil = new Date(now.getTime() + 1 * 60000); // 1 min cool-down for burst
            await currentUser.save();
            return errorResponse(res, 'You are typing too fast! Cooldown for 1 minute.', 429);
        }

        // B. Sustained Limit: Max 15 messages in 1 minute
        if (recentMessages.length >= 15) {
            currentUser.chatMutedUntil = new Date(now.getTime() + 5 * 60000); // 5 mins mute for sustained spam
            await currentUser.save();
            return errorResponse(res, 'Rate limit exceeded. Muted for 5 minutes.', 429);
        }

        // 4. Smart Duplicate Detection
        // Checks exact match OR normalized key match on the last message
        if (text && recentMessages.length > 0) {
            const lastMessage = recentMessages[recentMessages.length - 1]; // recentMessages is sorted by default? Need to ensure sort.

            if (lastMessage.text) {
                const lastTextNormalized = lastMessage.text.toLowerCase().replace(/[\s\W_]+/g, '');

                if (lastTextNormalized.length > 3 && lastTextNormalized === textNormalized) {
                    // Only check duplicates for meaningful length (>3 chars) to avoid blocking "ok", "yes"
                    return errorResponse(res, 'Please do not spam the same message.', 400);
                }
            }
        }

        const chat = await Chat.findById(chatId).populate('job');
        if (!chat) {
            return errorResponse(res, 'Chat not found', 404);
        }

        // --- OWNERSHIP CHECK (Constraint: Participant Verification) ---
        if (!chat.participants.map(p => p.toString()).includes(senderId)) {
            return errorResponse(res, 'Unauthorized: You are not a participant in this chat', 403);
        }

        const job = chat.job;
        if (!job) {
            return errorResponse(res, 'Job context invalid', 404);
        }

        // --- CONSTRAINT CHECKS ---

        // 1. Status Checks (Archived/Blocked)
        if (chat.status === 'blocked' || chat.status === 'archived') {
            return errorResponse(res, 'This chat is archived or blocked.', 403);
        }

        // 2. Job-Bound & Time-Bound Logic
        if (job.status === 'cancelled') {
            return errorResponse(res, 'Job is cancelled. Chat is closed.', 403);
        }

        if (job.status === 'completed') {
            const completionTime = job.completed_at || job.updated_at; // job.updated_at from timestamp config
            const hoursSinceCompletion = (Date.now() - new Date(completionTime).getTime()) / (1000 * 60 * 60);

            if (hoursSinceCompletion > 24) {
                return errorResponse(res, 'Job completed over 24 hours ago. Chat is closed. Please raise a support ticket.', 403);
            }
        }

        if (job.status === 'open' && job.quotation_end_time && new Date() > new Date(job.quotation_end_time)) {
            return errorResponse(res, 'Quotation window has ended. Chat is closed.', 403);
        }

        // 3. Dispute Lock (Constraint 10)
        if (job.dispute && job.dispute.is_disputed && job.dispute.status === 'open') {
            return errorResponse(res, 'Chat is read-only due to an active dispute.', 403);
        }

        // 5. Strict Contact Blocking (Constraint 2) - ANTI-CIRCUMVENTION FIREWALL
        // 5. Strict Contact Blocking (Constraint 2) - ANTI-CIRCUMVENTION FIREWALL
        if (text) {
            const hasPhone = CONTACT_PATTERNS.PHONE.test(text);
            CONTACT_PATTERNS.PHONE.lastIndex = 0; // Reset stateful regex

            const hasEmail = CONTACT_PATTERNS.EMAIL.test(text);
            CONTACT_PATTERNS.EMAIL.lastIndex = 0;

            const hasLinks = CONTACT_PATTERNS.LINKS.test(text);
            CONTACT_PATTERNS.LINKS.lastIndex = 0;

            const hasUPI = CONTACT_PATTERNS.UPI.test(text); // Basic check, might need refinement to avoid false positives with email
            CONTACT_PATTERNS.UPI.lastIndex = 0;

            if (hasPhone || hasEmail || hasLinks || hasUPI) {
                // We block the message entirely to prevent circumvention.
                return errorResponse(res, 'Sharing contact details (phone, email, links, UPI) is strictly prohibited. Keep all communication on SkillBridge for your safety and protection.', 400);
            }
        }

        // 5. Price Lock After Assignment (Constraint 6)
        // If job is assigned/in_progress, price shouldn't be discussed loosely.
        // Simplified price regex for this check
        if (text) {
            const priceRegex = /(?:price|cost|pay|rate|charge|amount|rupee|rs\.?|\$|€|£)\s*:?\s*\d+/i;
            if (['assigned', 'in_progress', 'reviewing'].includes(job.status)) {
                if (priceRegex.test(text)) {
                    return errorResponse(res, 'Price discussion is locked. Use the formal system request for any modifications.', 400);
                }
            }
        }

        // 6. Smart System Injection (Safety Warnings)
        // If unrelated to price locking, check for off-platform payment keywords associated with risk
        let systemWarningMessage = null;
        if (text) {
            const safetyTriggerRegex = /\b(cash|paytm|gpay|phonepe|google pay|bank transfer|direct|outside)\b/i;
            if (safetyTriggerRegex.test(text)) {
                systemWarningMessage = "⚠️ SAFETY ALERT: Payments made outside SkillBridge are NOT covered by our Insurance or Dispute Protection.";
            }
        }

        const recipientId = chat.participants.find(p => p.toString() !== senderId);
        let deliveredTo = [];

        if (recipientId) {
            const recipient = await User.findById(recipientId);
            // If user is "Online" (toggle on) or we can assume they are connected if we had socket info.
            // Using isOnline field as proxy for "App Open/Available"
            if (recipient && recipient.isOnline) {
                deliveredTo.push(recipientId);
            }
        }

        const message = await Message.create({
            chatId,
            senderId,
            text, // Can be undefined/null if media present
            media,
            readBy: [senderId],
            deliveredTo: deliveredTo
        });

        // Update Chat
        if (text && text.trim().length > 0) {
            chat.lastMessage = text;
        } else if (media && media.length > 0) {
            const type = media[0].fileType;
            chat.lastMessage = type === 'image' ? '📷 Image' : type === 'video' ? '🎥 Video' : '📎 Document';
        } else {
            chat.lastMessage = 'New Message';
        }
        chat.lastMessageTime = Date.now();

        chat.participants.forEach(pId => {
            if (pId.toString() !== senderId) {
                const currentCount = chat.unreadCounts.get(pId.toString()) || 0;
                chat.unreadCounts.set(pId.toString(), currentCount + 1);
            }
        });

        await chat.save();

        try {
            const { getIo } = require('../../socket/socket');
            const io = getIo();
            io.to(chatId).emit('receive_message', message);

            // 7. Inject System Warning if triggered
            if (systemWarningMessage) {
                const sysMsg = await Message.create({
                    chatId,
                    isSystemMessage: true,
                    text: systemWarningMessage,
                    readBy: [],
                    deliveredTo: []
                });
                io.to(chatId).emit('receive_message', sysMsg);

                // Update chat with system warning as last message
                chat.lastMessage = systemWarningMessage;
                chat.lastMessageTime = Date.now();
                await chat.save();
            }

        } catch (err) {
            console.error('Socket emit error:', err);
        }

        return successResponse(res, 'Message sent', message, 201);
    } catch (error) {
        console.error('Error sending message:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Get Messages
exports.getMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id;

        // --- OWNERSHIP CHECK (Constraint: Participant Verification) ---
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return errorResponse(res, 'Chat not found', 404);
        }
        if (!chat.participants.map(p => p.toString()).includes(userId)) {
            return errorResponse(res, 'Unauthorized: You are not a participant in this chat', 403);
        }

        const messages = await Message.find({ chatId }).sort({ createdAt: 1 });

        // Update read status for these messages
        // Find messages not read by me
        const unreadMessagesStringIds = messages
            .filter(m => !m.readBy.map(id => id.toString()).includes(userId))
            .map(m => m._id);

        if (unreadMessagesStringIds.length > 0) {
            await Message.updateMany(
                { _id: { $in: unreadMessagesStringIds } },
                { $addToSet: { readBy: userId, deliveredTo: userId } } // Reading implies delivery
            );

            // Emit 'messages_read' event to the chat room so sender updates UI
            try {
                const { getIo } = require('../../socket/socket');
                const io = getIo();
                io.to(chatId).emit('messages_read', {
                    messageIds: unreadMessagesStringIds,
                    readBy: userId,
                    chatId
                });
            } catch (e) {
                console.error('Socket emit read error', e);
            }
        }

        // Reset unread count for this user
        if (chat) {
            if (!chat.unreadCounts) { chat.unreadCounts = new Map(); }
            if (chat.unreadCounts.get(userId) > 0) {
                chat.unreadCounts.set(userId, 0);
                await chat.save();
            }
        }

        // Return updated messages (refetched or manually updated in memory? Refetch is safer but slower. 
        // For now, let's just return the original list but we know logic updated DB. 
        // Ideally should assume client treats them as read if it requested them? 
        // Client will see its own ID in readBy if we refetch. Let's refetch if we updated.)

        if (unreadMessagesStringIds.length > 0) {
            const updatedMessages = await Message.find({ chatId }).sort({ createdAt: 1 });
            return successResponse(res, 'Messages retrieved', updatedMessages);
        }

        return successResponse(res, 'Messages retrieved', messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        return errorResponse(res, 'Server error', 500);
    }
}
