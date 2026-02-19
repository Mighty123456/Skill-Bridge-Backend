const { SupportTicket, KnowledgeBaseArticle, HelpCategory } = require('./help-center.model');
const Job = require('../jobs/job.model');
const Chat = require('../chat/chat.model');
const Payment = require('../payments/payment.model');
const NotificationService = require('../notifications/notification.service');
const logger = require('../../config/logger');

class HelpCenterService {
  /**
   * Calculate SLA deadline based on priority
   */
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

  /**
   * Auto-attach job data (chat logs, timeline, payment details)
   */
  async attachJobData(jobId, userId) {
    try {
      const job = await Job.findById(jobId);
      if (!job) {
        return null;
      }

      // Verify user has access to this job
      const isOwner = job.user_id.toString() === userId.toString();
      const isWorker = job.selected_worker_id &&
        job.selected_worker_id.toString() === userId.toString();

      if (!isOwner && !isWorker) {
        return null;
      }

      // Get chat logs
      const Message = require('../chat/message.model');
      const chat = await Chat.findOne({ job: jobId });
      const chatLogs = chat
        ? await Message.find({ chatId: chat._id })
          .sort({ createdAt: -1 })
          .limit(50)
          .select('senderId text createdAt')
          .lean()
        : []; // Last 50 messages

      // Get timeline
      const timeline = job.timeline || [];

      // Get payment details
      const payments = await Payment.find({ job: jobId }).select('amount status createdAt');

      return {
        chatLogs: chatLogs.reverse().map(msg => ({
          senderId: msg.senderId,
          text: msg.text,
          createdAt: msg.createdAt
        })),
        timeline: timeline.map(item => ({
          status: item.status,
          timestamp: item.timestamp,
          actor: item.actor,
          note: item.note
        })),
        paymentDetails: payments.map(p => ({
          amount: p.amount,
          status: p.status,
          createdAt: p.createdAt
        }))
      };
    } catch (error) {
      logger.error(`Error attaching job data: ${error.message}`);
      return null;
    }
  }

  /**
   * Create a support ticket
   */
  async createTicket(userId, ticketData, attachments = []) {
    try {
      const ticket = new SupportTicket({
        ...ticketData,
        userId,
        slaDeadline: this.calculateSLADeadline(ticketData.priority || 'medium'),
        attachments: attachments
      });

      // Auto-attach job data if jobId exists
      if (ticketData.jobId) {
        const autoData = await this.attachJobData(ticketData.jobId, userId);
        if (autoData) {
          ticket.autoAttachedData = autoData;
        }
      }

      await ticket.save();

      // Trigger notification for high priority tickets
      if (ticketData.priority === 'critical' || ticketData.priority === 'high') {
        await this.notifySupportTeam(ticket);
      }

      // Notify user
      await NotificationService.createNotification({
        recipient: userId,
        title: 'Support Ticket Created',
        message: `Your ticket "${ticket.title}" has been created successfully`,
        type: 'ticket_created',
        data: { ticketId: ticket._id }
      });

      return ticket;
    } catch (error) {
      logger.error(`Error creating ticket: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user's tickets with filters
   */
  async getTickets(userId, filters = {}) {
    try {
      const query = { userId };

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.priority) {
        query.priority = filters.priority;
      }

      const tickets = await SupportTicket.find(query)
        .sort({ createdAt: -1 })
        .populate('jobId', 'job_title status')
        .populate('resolvedBy', 'name email')
        .lean();

      return tickets;
    } catch (error) {
      logger.error(`Error fetching tickets: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get single ticket
   */
  async getTicket(ticketId, userId) {
    try {
      const ticket = await SupportTicket.findOne({
        _id: ticketId,
        userId
      })
        .populate('jobId', 'job_title status')
        .populate('resolvedBy', 'name email');

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      return ticket;
    } catch (error) {
      logger.error(`Error fetching ticket: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add update to ticket
   */
  async addTicketUpdate(ticketId, userId, message, attachments = []) {
    try {
      const ticket = await SupportTicket.findOne({
        _id: ticketId,
        userId
      });

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if (ticket.status === 'closed' || ticket.status === 'resolved') {
        throw new Error('Cannot add update to closed/resolved ticket');
      }

      ticket.updates.push({
        message,
        actor: 'user',
        attachments,
        timestamp: new Date()
      });

      // Update status if it was awaiting user response
      if (ticket.status === 'awaiting_user_response') {
        ticket.status = 'under_review';
      }

      await ticket.save();

      // Notify support team
      await NotificationService.createNotification({
        recipient: ticket.userId,
        title: 'Ticket Update',
        message: `New update added to ticket "${ticket.title}"`,
        type: 'ticket_update',
        data: { ticketId: ticket._id }
      });

      return ticket;
    } catch (error) {
      logger.error(`Error adding ticket update: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submit feedback for resolved ticket
   */
  async submitFeedback(ticketId, userId, rating, feedback) {
    try {
      const ticket = await SupportTicket.findOne({
        _id: ticketId,
        userId
      });

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
        throw new Error('Can only submit feedback for resolved tickets');
      }

      ticket.satisfactionRating = rating;
      ticket.feedback = feedback;
      await ticket.save();

      return ticket;
    } catch (error) {
      logger.error(`Error submitting feedback: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get knowledge base articles
   */
  async getArticles(filters = {}) {
    try {
      const query = {};

      if (filters.category) {
        query.category = filters.category;
      }

      if (filters.role) {
        query.$or = [
          { role: 'all' },
          { role: filters.role }
        ];
      }

      if (filters.featured !== undefined) {
        query.isFeatured = filters.featured === true || filters.featured === 'true';
      }

      if (filters.search) {
        query.$text = { $search: filters.search };
      }

      let articles = KnowledgeBaseArticle.find(query);

      if (filters.search) {
        articles = articles.sort({ score: { $meta: 'textScore' } });
      } else {
        articles = articles.sort({ isFeatured: -1, createdAt: -1 });
      }

      const results = await articles.lean();

      // Increment view count if article is accessed individually
      if (filters.articleId && results.length > 0) {
        await KnowledgeBaseArticle.findByIdAndUpdate(filters.articleId, {
          $inc: { viewCount: 1 }
        });
      }

      return results;
    } catch (error) {
      logger.error(`Error fetching articles: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get single article
   */
  async getArticle(articleId) {
    try {
      const article = await KnowledgeBaseArticle.findById(articleId)
        .populate('relatedArticles', 'title category');

      if (!article) {
        throw new Error('Article not found');
      }

      // Increment view count
      await KnowledgeBaseArticle.findByIdAndUpdate(articleId, {
        $inc: { viewCount: 1 }
      });

      return article;
    } catch (error) {
      logger.error(`Error fetching article: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get help categories
   */
  async getCategories(role = null) {
    try {
      const query = {};

      if (role) {
        query.$or = [
          { role: 'all' },
          { role: role }
        ];
      }

      const categories = await HelpCategory.find(query)
        .sort({ order: 1, createdAt: 1 })
        .populate('articleIds', 'title category')
        .lean();

      return categories;
    } catch (error) {
      logger.error(`Error fetching categories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get contextual help based on job status
   */
  async getContextualHelp(jobStatus, role) {
    try {
      const query = {
        $or: [
          { jobStatus: { $in: [jobStatus] } },
          { role: { $in: [role, 'all'] } }
        ],
        isFeatured: true
      };

      const articles = await KnowledgeBaseArticle.find(query)
        .sort({ viewCount: -1 })
        .limit(10)
        .lean();

      return articles;
    } catch (error) {
      logger.error(`Error fetching contextual help: ${error.message}`);
      throw error;
    }
  }

  /**
   * Trigger emergency support
   */
  async triggerEmergency(userId, reason, jobId, location) {
    try {
      const ticket = await this.createTicket(userId, {
        category: 'emergency',
        title: `Emergency: ${reason}`,
        description: `Emergency support requested: ${reason}`,
        priority: 'critical',
        jobId: jobId || null,
        emergencyLocation: location || null
      });

      // Send immediate notification to admin/support team
      await this.notifyEmergencySupport(ticket);

      return ticket;
    } catch (error) {
      logger.error(`Error triggering emergency: ${error.message}`);
      throw error;
    }
  }

  /**
   * Notify support team for high priority tickets
   */
  async notifySupportTeam(ticket) {
    try {
      // In a real app, you'd fetch admin users or support team members
      // For now, we'll just log it
      logger.warn(`🚨 HIGH PRIORITY TICKET: ${ticket._id} - ${ticket.title} (Priority: ${ticket.priority})`);

      // You can add admin notification logic here
      // await NotificationService.createNotification({
      //   recipient: adminUserId,
      //   title: 'High Priority Ticket',
      //   message: `New ${ticket.priority} priority ticket: ${ticket.title}`,
      //   type: 'ticket_high_priority',
      //   data: { ticketId: ticket._id }
      // });
    } catch (error) {
      logger.error(`Error notifying support team: ${error.message}`);
    }
  }

  /**
   * Notify emergency support
   */
  async notifyEmergencySupport(ticket) {
    try {
      logger.error(`🚨🚨🚨 EMERGENCY SUPPORT REQUESTED: ${ticket._id} - ${ticket.title}`);
      logger.error(`User ID: ${ticket.userId}, Job ID: ${ticket.jobId || 'N/A'}`);

      if (ticket.emergencyLocation) {
        logger.error(`Location: ${ticket.emergencyLocation.latitude}, ${ticket.emergencyLocation.longitude}`);
      }

      // In a real app, you'd:
      // 1. Send SMS/WhatsApp to emergency support line
      // 2. Create high-priority notification for all admins
      // 3. Trigger escalation workflow
    } catch (error) {
      logger.error(`Error notifying emergency support: ${error.message}`);
    }
  }

  /**
   * Admin: Update ticket status
   */
  async updateTicketStatus(ticketId, status, adminId, notes) {
    try {
      const ticket = await SupportTicket.findById(ticketId);

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      ticket.status = status;

      if (status === 'resolved') {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = adminId;
        ticket.resolutionNotes = notes;
      }

      ticket.updates.push({
        message: notes || `Ticket status updated to ${status}`,
        actor: 'admin',
        timestamp: new Date()
      });

      await ticket.save();

      // Notify user
      await NotificationService.createNotification({
        recipient: ticket.userId,
        title: 'Ticket Status Updated',
        message: `Your ticket "${ticket.title}" status has been updated to ${status}`,
        type: 'ticket_status_update',
        data: { ticketId: ticket._id, status }
      });

      return ticket;
    } catch (error) {
      logger.error(`Error updating ticket status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Admin: Add reply to ticket (without status change)
   */
  async adminReplyToTicket(ticketId, adminId, message, attachments = []) {
    try {
      const ticket = await SupportTicket.findById(ticketId);

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      ticket.updates.push({
        message,
        actor: 'admin',
        attachments,
        timestamp: new Date()
      });

      // If status was 'open', move it to 'under_review' automatically on admin reply
      if (ticket.status === 'open') {
        ticket.status = 'under_review';
      }

      await ticket.save();

      // Notify user
      await NotificationService.createNotification({
        recipient: ticket.userId,
        title: 'New Support Message',
        message: `Support team has replied to your ticket: "${ticket.title}"`,
        type: 'ticket_reply',
        data: { ticketId: ticket._id }
      });

      return ticket;
    } catch (error) {
      logger.error(`Error adding admin ticket reply: ${error.message}`);
      throw error;
    }
  }

  /**
   * Admin: Get all tickets
   */
  async getAllTickets(filters = {}) {
    try {
      const query = {};

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.priority) {
        query.priority = filters.priority;
      }
      if (filters.userId) {
        query.userId = filters.userId;
      }

      const tickets = await SupportTicket.find(query)
        .sort({ createdAt: -1 })
        .populate('userId', 'name email role')
        .populate('jobId', 'job_title status')
        .populate('resolvedBy', 'name email')
        .lean();

      return tickets;
    } catch (error) {
      logger.error(`Error fetching all tickets: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new HelpCenterService();
