# Help Center Backend Implementation Guide

## 📋 Overview

The Help Center module requires complete backend implementation. This document outlines all required components.

## 🗂️ Required File Structure

```
skillbridge_backend/src/modules/help-center/
├── help-center.model.js          # SupportTicket & KnowledgeBaseArticle models
├── help-center.service.js         # Business logic
├── help-center.controller.js      # Request handlers
├── help-center.routes.js          # Route definitions
└── help-center.validation.js      # Input validation schemas
```

## 📦 Database Models

### 1. SupportTicket Model

```javascript
const mongoose = require('mongoose');

const ticketUpdateSchema = new mongoose.Schema({
  message: { type: String, required: true },
  actor: { type: String, enum: ['user', 'support', 'admin', 'system'], required: true },
  attachments: [{ type: String }],
  timestamp: { type: Date, default: Date.now }
});

const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', index: true },
  category: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  status: { 
    type: String, 
    enum: ['open', 'under_review', 'awaiting_user_response', 'resolved', 'closed', 'escalated'],
    default: 'open',
    index: true
  },
  attachments: [{ type: String }], // URLs
  autoAttachedData: {
    chatLogs: [{ type: mongoose.Schema.Types.Mixed }],
    timeline: [{ type: mongoose.Schema.Types.Mixed }],
    paymentDetails: { type: mongoose.Schema.Types.Mixed }
  },
  updates: [ticketUpdateSchema],
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolutionNotes: String,
  satisfactionRating: { type: Number, min: 1, max: 5 },
  feedback: String,
  slaDeadline: Date, // Calculated based on priority
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Indexes
supportTicketSchema.index({ userId: 1, status: 1 });
supportTicketSchema.index({ priority: 1, status: 1 });
supportTicketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
```

### 2. KnowledgeBaseArticle Model

```javascript
const mongoose = require('mongoose');

const knowledgeBaseArticleSchema = new mongoose.Schema({
  title: { type: String, required: true, index: 'text' },
  content: { type: String, required: true },
  category: { type: String, enum: ['faq', 'guide', 'policy', 'tutorial'], required: true, index: true },
  tags: [{ type: String, index: true }],
  videoUrl: String,
  images: [{ type: String }],
  viewCount: { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false, index: true },
  role: { type: String, enum: ['all', 'tenant', 'worker', 'contractor'], default: 'all', index: true },
  jobStatus: [{ type: String }], // For contextual help
  relatedArticles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeBaseArticle' }],
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Text search index
knowledgeBaseArticleSchema.index({ title: 'text', content: 'text', tags: 'text' });

module.exports = mongoose.model('KnowledgeBaseArticle', knowledgeBaseArticleSchema);
```

### 3. HelpCategory Model

```javascript
const mongoose = require('mongoose');

const helpCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: 'help_outline' },
  description: String,
  articleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeBaseArticle' }],
  role: { type: String, enum: ['all', 'tenant', 'worker', 'contractor'], default: 'all', index: true },
  order: { type: Number, default: 0 }
});

module.exports = mongoose.model('HelpCategory', helpCategorySchema);
```

## 🛣️ API Routes

### Routes File: `help-center.routes.js`

```javascript
const express = require('express');
const router = express.Router();
const helpCenterController = require('./help-center.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { adminOnly } = require('../../common/middleware/role.middleware');

// Support Tickets
router.get('/tickets', protect, helpCenterController.getTickets);
router.post('/tickets', protect, helpCenterController.createTicket);
router.get('/tickets/:ticketId', protect, helpCenterController.getTicket);
router.put('/tickets/:ticketId', protect, helpCenterController.updateTicket);
router.post('/tickets/:ticketId/updates', protect, helpCenterController.addTicketUpdate);
router.post('/tickets/:ticketId/feedback', protect, helpCenterController.submitFeedback);

// Knowledge Base
router.get('/knowledge-base', helpCenterController.getArticles); // Public
router.get('/knowledge-base/:articleId', helpCenterController.getArticle); // Public
router.get('/categories', helpCenterController.getCategories); // Public
router.get('/contextual-help', protect, helpCenterController.getContextualHelp);

// Emergency Support
router.post('/emergency', protect, helpCenterController.triggerEmergency);

// Admin Routes
router.get('/admin/tickets', protect, adminOnly, helpCenterController.getAllTickets);
router.put('/admin/tickets/:ticketId/status', protect, adminOnly, helpCenterController.updateTicketStatus);
router.post('/admin/articles', protect, adminOnly, helpCenterController.createArticle);
router.put('/admin/articles/:articleId', protect, adminOnly, helpCenterController.updateArticle);
router.delete('/admin/articles/:articleId', protect, adminOnly, helpCenterController.deleteArticle);

module.exports = router;
```

## 🔧 Service Layer

### Key Service Methods

```javascript
// help-center.service.js

class HelpCenterService {
  // Calculate SLA deadline based on priority
  calculateSLADeadline(priority) {
    const now = new Date();
    const hours = {
      'critical': 0.25,  // 15 minutes
      'high': 1,         // 1 hour
      'medium': 24,      // 24 hours
      'low': 48          // 48 hours
    };
    return new Date(now.getTime() + (hours[priority] || 24) * 60 * 60 * 1000);
  }

  // Auto-attach job data
  async attachJobData(jobId, userId) {
    const Job = require('../jobs/job.model');
    const Chat = require('../chat/chat.model');
    
    const job = await Job.findById(jobId);
    if (!job || job.user_id.toString() !== userId.toString()) {
      return null;
    }

    // Get chat logs
    const chat = await Chat.findOne({ jobId: jobId });
    const chatLogs = chat ? chat.messages : [];

    // Get timeline
    const timeline = job.timeline || [];

    // Get payment details
    const Payment = require('../payments/payment.model');
    const payments = await Payment.find({ jobId: jobId });

    return {
      chatLogs: chatLogs.slice(-50), // Last 50 messages
      timeline: timeline,
      paymentDetails: payments
    };
  }

  // Create ticket
  async createTicket(userId, ticketData, attachments = []) {
    const SupportTicket = require('./help-center.model').SupportTicket;
    
    const ticket = new SupportTicket({
      ...ticketData,
      userId,
      slaDeadline: this.calculateSLADeadline(ticketData.priority),
      attachments: attachments.map(att => att.url)
    });

    // Auto-attach job data if jobId exists
    if (ticketData.jobId) {
      ticket.autoAttachedData = await this.attachJobData(ticketData.jobId, userId);
    }

    await ticket.save();
    
    // Trigger notification for high priority tickets
    if (ticketData.priority === 'critical' || ticketData.priority === 'high') {
      await this.notifySupportTeam(ticket);
    }

    return ticket;
  }

  // Get contextual help
  async getContextualHelp(jobStatus, role) {
    const KnowledgeBaseArticle = require('./help-center.model').KnowledgeBaseArticle;
    
    return await KnowledgeBaseArticle.find({
      $or: [
        { jobStatus: { $in: [jobStatus] } },
        { role: { $in: [role, 'all'] } }
      ],
      isFeatured: true
    }).limit(10);
  }

  // Trigger emergency
  async triggerEmergency(userId, reason, jobId, location) {
    const ticket = await this.createTicket(userId, {
      category: 'emergency',
      title: `Emergency: ${reason}`,
      description: `Emergency support requested: ${reason}`,
      priority: 'critical',
      jobId
    });

    // Send immediate notification
    await this.notifyEmergencySupport(ticket, location);

    return ticket;
  }
}

module.exports = new HelpCenterService();
```

## 📝 Controller Implementation

### Example Controller Methods

```javascript
// help-center.controller.js

exports.getTickets = async (req, res) => {
  try {
    const { status, priority } = req.query;
    const SupportTicket = require('./help-center.model').SupportTicket;
    
    const query = { userId: req.user._id };
    if (status) query.status = status;
    if (priority) query.priority = priority;

    const tickets = await SupportTicket.find(query)
      .sort({ createdAt: -1 })
      .populate('jobId', 'job_title status');

    res.json({ success: true, data: tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTicket = async (req, res) => {
  try {
    const { category, title, description, priority, jobId, autoAttachedData } = req.body;
    const HelpCenterService = require('./help-center.service');
    
    // Handle file uploads
    const attachments = req.files?.attachments || [];

    const ticket = await HelpCenterService.createTicket(
      req.user._id,
      { category, title, description, priority, jobId, autoAttachedData },
      attachments
    );

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getContextualHelp = async (req, res) => {
  try {
    const { jobStatus, role } = req.query;
    const HelpCenterService = require('./help-center.service');
    
    const articles = await HelpCenterService.getContextualHelp(
      jobStatus || 'open',
      role || req.user.role
    );

    res.json({ success: true, data: articles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
```

## 🔗 Integration Steps

### 1. Register Routes in `routes.js`

```javascript
// Add to skillbridge_backend/src/routes/routes.js
router.use('/help-center', require('../modules/help-center/help-center.routes'));
```

### 2. File Upload Support

Ensure `upload` module handles help center attachments:

```javascript
// In upload.controller.js, add help-center category
const allowedCategories = ['profile', 'job', 'document', 'help-center'];
```

### 3. Notification Integration

Add help center notifications:

```javascript
// In notification.service.js
async notifyTicketUpdate(ticket, update) {
  // Send notification to user
  await this.createNotification({
    userId: ticket.userId,
    type: 'ticket_update',
    title: 'Ticket Update',
    message: `Your ticket "${ticket.title}" has been updated`,
    data: { ticketId: ticket._id }
  });
}
```

## ✅ Implementation Checklist

- [ ] Create database models (SupportTicket, KnowledgeBaseArticle, HelpCategory)
- [ ] Create service layer with business logic
- [ ] Create controller with request handlers
- [ ] Create routes file
- [ ] Add input validation schemas
- [ ] Register routes in main routes.js
- [ ] Implement file upload for attachments
- [ ] Implement auto-attach job data logic
- [ ] Add SLA deadline calculation
- [ ] Implement notification system
- [ ] Add admin endpoints for ticket management
- [ ] Create seed data for knowledge base articles
- [ ] Add search functionality
- [ ] Implement contextual help logic
- [ ] Add emergency support handler
- [ ] Write unit tests
- [ ] Write integration tests

## 📚 Required Knowledge Base Articles

Create initial articles for:
- How escrow works
- Cancellation policy
- Payment timeline
- Warranty rules
- Rating system
- Role-specific FAQs

## 🔐 Security Considerations

- ✅ Authentication required for all ticket operations
- ✅ Users can only access their own tickets
- ✅ Admin-only endpoints for ticket management
- ✅ File upload validation and virus scanning
- ✅ Rate limiting on emergency endpoint
- ✅ Input sanitization for all user inputs

## 📊 Monitoring & Analytics

Consider adding:
- Ticket resolution time tracking
- SLA compliance monitoring
- Most common issues tracking
- User satisfaction metrics
- Knowledge base article views
