const Chat = require('./chat.model');
const Message = require('./message.model');
const User = require('../users/user.model');
const Job = require('../jobs/job.model');
const logger = require('../../config/logger');
const notifyHelper = require('../../common/notification.helper');
const fraudDetectionService = require('../fraud/fraud-detection.service');
const { BASE_ABUSIVE_WORDS, CONTACT_PATTERNS } = require('../../common/constants/moderation');

// --- MODERATION CONFIGURATION ---
const LEET_MAP = {
    'a': '[a@4]', 'i': '[i1!|]', 'o': '[o0]', 's': '[s$5]', 'e': '[e3]', 'l': '[l1|]', 't': '[t7+]'
};

const buildProfanityRegex = (words) => {
    const patternString = words.map(word => {
        return word.split('').map(char => {
            const lower = char.toLowerCase();
            const leet = LEET_MAP[lower] || lower;
            return `${leet}[\\W_]*`;
        }).join('');
    }).join('|');
    return new RegExp(`(${patternString})`, 'i');
};

const PROFANITY_REGEX = buildProfanityRegex(BASE_ABUSIVE_WORDS);

const checkProfanityAPI = async (text) => {
    try {
        const response = await fetch(`https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(text)}`);
        const result = await response.text();
        return result === 'true';
    } catch (error) {
        logger.error('Moderation API Error (Fail Open):', error.message);
        return false;
    }
};

/**
 * Core service to process and send a chat message, enforcing all industry constraints.
 * Used by both REST Controller and Socket Handler.
 */
exports.processAndSendMessage = async ({ chatId, senderId, text, media, isEncrypted = false }) => {
    // 1. Basic Validation
    if (!chatId || (!text && (!media || media.length === 0))) {
        throw { status: 400, message: 'Chat ID and either text or media are required' };
    }

    const currentUser = await User.findById(senderId);
    if (!currentUser) throw { status: 404, message: 'User not found' };

    // 2. System Mute Enforcement
    if (currentUser.chatMutedUntil && new Date() < new Date(currentUser.chatMutedUntil)) {
        const minutesLeft = Math.ceil((new Date(currentUser.chatMutedUntil) - new Date()) / 60000);
        throw { status: 403, message: `You are temporarily muted for ${minutesLeft} minutes due to policy violations.` };
    }

    const chat = await Chat.findById(chatId).populate('job');
    if (!chat) throw { status: 404, message: 'Chat not found' };

    // 3. Media Type Validation
    if (media && media.length > 0) {
        const allowedTypes = ['image', 'video', 'document'];
        const invalidMedia = media.find(m => !allowedTypes.includes(m.fileType));
        if (invalidMedia) {
            throw { status: 400, message: 'Invalid media type. Only images, videos, and documents are allowed.' };
        }
    }

    // 4. Ownership / Participant Verification
    if (!chat.participants.map(p => p.toString()).includes(senderId.toString())) {
        throw { status: 403, message: 'Unauthorized: You are not a participant in this chat' };
    }

    const job = chat.job;
    if (!job) throw { status: 404, message: 'Job context invalid' };

    // 5. Status Checks (Archived/Blocked)
    if (chat.status === 'blocked' || chat.status === 'archived') {
        throw { status: 403, message: 'This chat is archived or blocked.' };
    }

    // 6. Job-Bound & Time-Bound Logic
    if (job.status === 'cancelled') {
        throw { status: 403, message: 'Job is cancelled. Chat is closed.' };
    }

    if (job.status === 'completed') {
        const completionTime = job.completed_at || job.updated_at;
        const hoursSinceCompletion = (Date.now() - new Date(completionTime).getTime()) / (1000 * 60 * 60);
        if (hoursSinceCompletion > 24) {
            throw { status: 403, message: 'Job completed over 24 hours ago. Chat is closed. Please raise a support ticket.' };
        }
    }

    if (job.status === 'open' && job.quotation_end_time && new Date() > new Date(job.quotation_end_time)) {
        throw { status: 403, message: 'Quotation window has ended. Chat is closed.' };
    }

    // 7. Dispute Lock
    if (job.dispute && job.dispute.is_disputed && job.dispute.status === 'open') {
        throw { status: 403, message: 'Chat is read-only due to an active dispute.' };
    }

    // --- MODERATION CHECKS ---
    let textNormalized = text ? text.toLowerCase().replace(/[\s\W_]+/g, '') : '';

    if (text) {
        // 7. Profanity Detection
        let isAbusive = PROFANITY_REGEX.test(text);
        if (!isAbusive) {
            isAbusive = await checkProfanityAPI(text);
        }

        if (isAbusive) {
            currentUser.chatStrikes = (currentUser.chatStrikes || 0) + 1;
            let errorMsg = 'Message blocked: Profanity or abusive patterns detected.';

            if (currentUser.chatStrikes >= 3) {
                currentUser.chatMutedUntil = new Date(Date.now() + 15 * 60000); // 15 mins mute
                currentUser.chatStrikes = 0;
                errorMsg = 'Violation 3/3. You have been muted for 15 minutes due to repeated abusive language.';
                await fraudDetectionService.detectProfanityViolation(senderId, text, 3).catch(e => logger.error(e));
            } else {
                errorMsg += ` Violation ${currentUser.chatStrikes}/3. Continued abuse will lead to a mute.`;
            }
            await currentUser.save();
            throw { status: 400, message: errorMsg };
        }

        // 8. Contact Blocking (Anti-Circumvention)
        const hasPhone = CONTACT_PATTERNS.PHONE.test(text);
        CONTACT_PATTERNS.PHONE.lastIndex = 0;
        const hasEmail = CONTACT_PATTERNS.EMAIL.test(text);
        CONTACT_PATTERNS.EMAIL.lastIndex = 0;
        const hasLinks = CONTACT_PATTERNS.LINKS.test(text);
        CONTACT_PATTERNS.LINKS.lastIndex = 0;
        const hasUPI = CONTACT_PATTERNS.UPI.test(text);
        CONTACT_PATTERNS.UPI.lastIndex = 0;

        if (hasPhone || hasEmail || hasLinks || hasUPI) {
            await fraudDetectionService.detectContactSharing(senderId, job._id).catch(e => logger.error(e));
            throw { status: 400, message: 'Sharing contact details (phone, email, links, UPI) is strictly prohibited. Keep all communication on SkillBridge for your safety.' };
        }

        // 9. Price Lock After Assignment
        if (['assigned', 'in_progress', 'reviewing'].includes(job.status)) {
            const priceRegex = /(?:price|cost|pay|rate|charge|amount|rupee|rs\.?|\$|€|£)\s*:?\s*\d+/i;
            if (priceRegex.test(text)) {
                throw { status: 400, message: 'Price discussion is locked. Use the formal system request for any modifications.' };
            }
        }
    }

    // 10. Rate Limiting & Burst Protection
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const fiveSecondsAgo = new Date(now.getTime() - 5000);

    const recentMessages = await Message.find({
        senderId,
        createdAt: { $gte: oneMinuteAgo }
    }).sort({ createdAt: 1 });

    const burstCount = recentMessages.filter(m => m.createdAt > fiveSecondsAgo).length;
    if (burstCount >= 5) {
        currentUser.chatMutedUntil = new Date(now.getTime() + 1 * 60000);
        await currentUser.save();
        throw { status: 429, message: 'You are typing too fast! Cooldown for 1 minute.' };
    }

    if (recentMessages.length >= 15) {
        currentUser.chatMutedUntil = new Date(now.getTime() + 5 * 60000);
        await currentUser.save();
        throw { status: 429, message: 'Rate limit exceeded. Muted for 5 minutes.' };
    }

    // 11. Smart Duplicate Detection
    if (text && recentMessages.length > 0) {
        const lastMessage = recentMessages[recentMessages.length - 1];
        if (lastMessage.text) {
            const lastTextNormalized = lastMessage.text.toLowerCase().replace(/[\s\W_]+/g, '');
            if (lastTextNormalized.length > 3 && lastTextNormalized === textNormalized) {
                throw { status: 400, message: 'Please do not spam the same message.' };
            }
        }
    }

    // --- EXECUTION ---

    // Safety Warnings (Don't block, just flag)
    let systemWarningMessage = null;
    if (text) {
        const safetyTriggerRegex = /\b(cash|paytm|gpay|phonepe|google pay|bank transfer|direct|outside)\b/i;
        if (safetyTriggerRegex.test(text)) {
            systemWarningMessage = "⚠️ SAFETY ALERT: Payments made outside SkillBridge are NOT covered by our Insurance or Dispute Protection.";
        }
    }

    // Save Message
    const recipientId = chat.participants.find(p => p.toString() !== senderId);

    // Check if recipient is online (simple check)
    const recipient = await User.findById(recipientId);
    let deliveredTo = [];
    if (recipient && recipient.isOnline) {
        deliveredTo.push(recipientId);
    }

    const message = await Message.create({
        chatId,
        senderId,
        text,
        media,
        isEncrypted,
        readBy: [senderId],
        deliveredTo: deliveredTo
    });

    // Update Chat metadata
    if (text && text.trim().length > 0) {
        chat.lastMessage = text;
    } else if (media && media.length > 0) {
        const type = media[0].fileType;
        chat.lastMessage = type === 'image' ? '📷 Image' : type === 'video' ? '🎥 Video' : '📎 Document';
    } else {
        chat.lastMessage = 'New Message';
    }
    chat.lastMessageTime = Date.now();

    // Re-surface the chat for anyone who deleted it if someone sends a new message
    chat.deletedBy = [];

    chat.participants.forEach(pId => {
        if (pId.toString() !== senderId) {
            const currentCount = chat.unreadCounts.get(pId.toString()) || 0;
            chat.unreadCounts.set(pId.toString(), currentCount + 1);
        }
    });
    await chat.save();

    // Trigger FCM Background Notification (Async)
    if (recipientId) {
        const messagePreview = text || (media && media.length > 0 ? (media[0].fileType === 'image' ? 'Sent an image' : 'Sent a file') : 'New message');
        notifyHelper.onNewChatMessage(
            recipientId,
            currentUser.name,
            messagePreview,
            chatId,
            senderId,
            job._id
        ).catch(err => logger.error(`FCM Push failed: ${err.message}`));
    }

    // Create System Message if warning triggered
    let systemMessage = null;
    if (systemWarningMessage) {
        systemMessage = await Message.create({
            chatId,
            isSystemMessage: true,
            text: systemWarningMessage
        });
        // We don't update lastMessage to the warning to avoid confusing the chat list, 
        // but some apps do. Keeping consistency with requirement.
    }

    return { message, systemMessage, chat };
};
