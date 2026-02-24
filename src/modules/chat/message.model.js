const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: true
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function () { return !this.isSystemMessage; }
    },
    isSystemMessage: {
        type: Boolean,
        default: false
    },
    text: {
        type: String,
        trim: true,
        // Text is required unless it's a media message or system message (though system usually has text)
        required: function () {
            return (!this.media || this.media.length === 0) && !this.isSystemMessage;
        }
    },
    media: [{
        url: { type: String, required: true },
        fileType: {
            type: String,
            enum: ['image', 'video', 'document'],
            required: true
        },
        originalName: String
    }],
    readBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    deliveredTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    isEncrypted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

messageSchema.index({ chatId: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
