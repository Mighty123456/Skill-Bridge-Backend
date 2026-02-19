const mongoose = require('mongoose');

// Ticket Update Schema
const ticketUpdateSchema = new mongoose.Schema({
  message: { type: String, required: true, trim: true },
  actor: { 
    type: String, 
    enum: ['user', 'support', 'admin', 'system'], 
    required: true 
  },
  attachments: [{ type: String }], // URLs
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

// Support Ticket Schema
const supportTicketSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  jobId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Job', 
    index: true 
  },
  category: { 
    type: String, 
    required: true,
    trim: true
  },
  title: { 
    type: String, 
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: { 
    type: String, 
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'], 
    default: 'medium', 
    index: true 
  },
  status: { 
    type: String, 
    enum: ['open', 'under_review', 'awaiting_user_response', 'resolved', 'closed', 'escalated'],
    default: 'open',
    index: true
  },
  attachments: [{ type: String }], // URLs from Cloudinary
  autoAttachedData: {
    chatLogs: [{ type: mongoose.Schema.Types.Mixed }],
    timeline: [{ type: mongoose.Schema.Types.Mixed }],
    paymentDetails: { type: mongoose.Schema.Types.Mixed }
  },
  updates: [ticketUpdateSchema],
  resolvedAt: Date,
  resolvedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  resolutionNotes: String,
  satisfactionRating: { 
    type: Number, 
    min: 1, 
    max: 5 
  },
  feedback: String,
  slaDeadline: Date, // Calculated based on priority
  emergencyLocation: {
    latitude: Number,
    longitude: Number
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Indexes
supportTicketSchema.index({ userId: 1, status: 1 });
supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ priority: 1, status: 1 });
supportTicketSchema.index({ createdAt: -1 });
supportTicketSchema.index({ slaDeadline: 1 });

// Knowledge Base Article Schema
const knowledgeBaseArticleSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: true,
    trim: true,
    index: 'text'
  },
  content: { 
    type: String, 
    required: true,
    index: 'text'
  },
  category: { 
    type: String, 
    enum: ['faq', 'guide', 'policy', 'tutorial'], 
    required: true, 
    index: true 
  },
  tags: [{ 
    type: String, 
    trim: true,
    index: true 
  }],
  videoUrl: String,
  images: [{ type: String }], // URLs
  viewCount: { 
    type: Number, 
    default: 0 
  },
  isFeatured: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  role: { 
    type: String, 
    enum: ['all', 'tenant', 'worker', 'contractor'], 
    default: 'all', 
    index: true 
  },
  jobStatus: [{ 
    type: String 
  }], // For contextual help: ['assigned', 'in_progress', 'completed']
  relatedArticles: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'KnowledgeBaseArticle' 
  }],
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Text search index
knowledgeBaseArticleSchema.index({ title: 'text', content: 'text', tags: 'text' });
knowledgeBaseArticleSchema.index({ role: 1, isFeatured: 1 });

// Help Category Schema
const helpCategorySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  icon: { 
    type: String, 
    default: 'help_outline' 
  },
  description: {
    type: String,
    trim: true
  },
  articleIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'KnowledgeBaseArticle' 
  }],
  role: { 
    type: String, 
    enum: ['all', 'tenant', 'worker', 'contractor'], 
    default: 'all', 
    index: true 
  },
  order: { 
    type: Number, 
    default: 0 
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

helpCategorySchema.index({ role: 1, order: 1 });

// Models
const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
const KnowledgeBaseArticle = mongoose.model('KnowledgeBaseArticle', knowledgeBaseArticleSchema);
const HelpCategory = mongoose.model('HelpCategory', helpCategorySchema);

module.exports = {
  SupportTicket,
  KnowledgeBaseArticle,
  HelpCategory
};
