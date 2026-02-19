const HelpCenterService = require('./help-center.service');
const { SupportTicket, KnowledgeBaseArticle, HelpCategory } = require('./help-center.model');
const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
const logger = require('../../config/logger');

/**
 * Get user's tickets
 */
exports.getTickets = async (req, res) => {
  try {
    const { status, priority } = req.query;
    
    const tickets = await HelpCenterService.getTickets(req.user._id, {
      status,
      priority
    });

    res.json({ 
      success: true, 
      data: tickets 
    });
  } catch (error) {
    logger.error(`Get Tickets Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Create a new ticket
 */
exports.createTicket = async (req, res) => {
  try {
    const { category, title, description, priority, jobId, autoAttachedData } = req.body;

    // Validate required fields
    if (!category || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category, title, and description are required'
      });
    }

    // Handle file uploads
    const attachments = [];
    if (req.files && req.files.length > 0) {
      logger.info(`Uploading ${req.files.length} attachments for ticket...`);
      
      const uploadPromises = req.files.map(file =>
        uploadOptimizedImage(file.buffer, `skillbridge/help-center/tickets/${req.user._id}`)
      );

      const uploadResults = await Promise.all(uploadPromises);
      uploadResults.forEach(result => attachments.push(result.url));
      logger.info(`Successfully uploaded ${attachments.length} attachments`);
    }

    // Parse autoAttachedData if it's a string
    let parsedAutoData = null;
    if (autoAttachedData) {
      try {
        parsedAutoData = typeof autoAttachedData === 'string' 
          ? JSON.parse(autoAttachedData) 
          : autoAttachedData;
      } catch (e) {
        logger.warn('Failed to parse autoAttachedData, using as is');
        parsedAutoData = autoAttachedData;
      }
    }

    const ticket = await HelpCenterService.createTicket(
      req.user._id,
      {
        category,
        title,
        description,
        priority: priority || 'medium',
        jobId: jobId || null,
        autoAttachedData: parsedAutoData
      },
      attachments
    );

    res.status(201).json({ 
      success: true, 
      message: 'Ticket created successfully',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Create Ticket Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Get single ticket
 */
exports.getTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    const ticket = await HelpCenterService.getTicket(ticketId, req.user._id);

    res.json({ 
      success: true, 
      data: ticket 
    });
  } catch (error) {
    logger.error(`Get Ticket Error: ${error.message}`);
    
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Update ticket (user can update their own ticket)
 */
exports.updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const updates = req.body;

    const ticket = await SupportTicket.findOne({ 
      _id: ticketId, 
      userId: req.user._id 
    });

    if (!ticket) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found' 
      });
    }

    // Users can only update certain fields
    if (updates.title) ticket.title = updates.title;
    if (updates.description) ticket.description = updates.description;
    if (updates.category) ticket.category = updates.category;

    await ticket.save();

    res.json({ 
      success: true, 
      message: 'Ticket updated successfully',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Update Ticket Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Add update to ticket
 */
exports.addTicketUpdate = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Handle file uploads
    const attachments = [];
    if (req.files && req.files.length > 0) {
      logger.info(`Uploading ${req.files.length} attachments for ticket update...`);
      
      const uploadPromises = req.files.map(file =>
        uploadOptimizedImage(file.buffer, `skillbridge/help-center/tickets/${req.user._id}/updates`)
      );

      const uploadResults = await Promise.all(uploadPromises);
      uploadResults.forEach(result => attachments.push(result.url));
    }

    const ticket = await HelpCenterService.addTicketUpdate(
      ticketId,
      req.user._id,
      message.trim(),
      attachments
    );

    res.json({ 
      success: true, 
      message: 'Update added successfully',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Add Ticket Update Error: ${error.message}`);
    
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Submit feedback for resolved ticket
 */
exports.submitFeedback = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const ticket = await HelpCenterService.submitFeedback(
      ticketId,
      req.user._id,
      rating,
      feedback || ''
    );

    res.json({ 
      success: true, 
      message: 'Feedback submitted successfully',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Submit Feedback Error: ${error.message}`);
    
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Get knowledge base articles
 */
exports.getArticles = async (req, res) => {
  try {
    const { category, role, search, featured } = req.query;

    const articles = await HelpCenterService.getArticles({
      category,
      role,
      search,
      featured: featured === 'true' || featured === true
    });

    res.json({ 
      success: true, 
      data: articles 
    });
  } catch (error) {
    logger.error(`Get Articles Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Get single article
 */
exports.getArticle = async (req, res) => {
  try {
    const { articleId } = req.params;
    
    const article = await HelpCenterService.getArticle(articleId);

    res.json({ 
      success: true, 
      data: article 
    });
  } catch (error) {
    logger.error(`Get Article Error: ${error.message}`);
    
    if (error.message === 'Article not found') {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Get help categories
 */
exports.getCategories = async (req, res) => {
  try {
    const { role } = req.query;
    
    const categories = await HelpCenterService.getCategories(role);

    res.json({ 
      success: true, 
      data: categories 
    });
  } catch (error) {
    logger.error(`Get Categories Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Get contextual help based on job status
 */
exports.getContextualHelp = async (req, res) => {
  try {
    const { jobStatus, role } = req.query;
    const userRole = role || req.user?.role || 'user';
    
    const articles = await HelpCenterService.getContextualHelp(
      jobStatus || 'open',
      userRole
    );

    res.json({ 
      success: true, 
      data: articles 
    });
  } catch (error) {
    logger.error(`Get Contextual Help Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Trigger emergency support
 */
exports.triggerEmergency = async (req, res) => {
  try {
    const { reason, jobId, location } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for emergency support'
      });
    }

    const ticket = await HelpCenterService.triggerEmergency(
      req.user._id,
      reason.trim(),
      jobId || null,
      location || null
    );

    res.status(201).json({ 
      success: true, 
      message: 'Emergency support request submitted. Our team will contact you immediately.',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Trigger Emergency Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============ ADMIN ENDPOINTS ============

/**
 * Admin: Get all tickets
 */
exports.getAllTickets = async (req, res) => {
  try {
    const { status, priority, userId } = req.query;
    
    const tickets = await HelpCenterService.getAllTickets({
      status,
      priority,
      userId
    });

    res.json({ 
      success: true, 
      data: tickets 
    });
  } catch (error) {
    logger.error(`Admin Get All Tickets Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Admin: Update ticket status
 */
exports.updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const validStatuses = ['open', 'under_review', 'awaiting_user_response', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const ticket = await HelpCenterService.updateTicketStatus(
      ticketId,
      status,
      req.user._id,
      notes || ''
    );

    res.json({ 
      success: true, 
      message: 'Ticket status updated successfully',
      data: ticket 
    });
  } catch (error) {
    logger.error(`Admin Update Ticket Status Error: ${error.message}`);
    
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Admin: Create article
 */
exports.createArticle = async (req, res) => {
  try {
    const { title, content, category, tags, videoUrl, role, jobStatus, relatedArticles } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, content, and category are required'
      });
    }

    // Handle image uploads
    const images = [];
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadOptimizedImage(file.buffer, `skillbridge/help-center/articles`)
      );
      const uploadResults = await Promise.all(uploadPromises);
      uploadResults.forEach(result => images.push(result.url));
    }

    const article = await KnowledgeBaseArticle.create({
      title,
      content,
      category,
      tags: tags || [],
      videoUrl: videoUrl || null,
      images: images.length > 0 ? images : (req.body.images || []),
      role: role || 'all',
      jobStatus: jobStatus || [],
      relatedArticles: relatedArticles || []
    });

    res.status(201).json({ 
      success: true, 
      message: 'Article created successfully',
      data: article 
    });
  } catch (error) {
    logger.error(`Admin Create Article Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Admin: Update article
 */
exports.updateArticle = async (req, res) => {
  try {
    const { articleId } = req.params;
    const updates = req.body;

    const article = await KnowledgeBaseArticle.findById(articleId);
    
    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    // Handle image uploads
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadOptimizedImage(file.buffer, `skillbridge/help-center/articles`)
      );
      const uploadResults = await Promise.all(uploadPromises);
      updates.images = uploadResults.map(r => r.url);
    }

    Object.assign(article, updates);
    await article.save();

    res.json({ 
      success: true, 
      message: 'Article updated successfully',
      data: article 
    });
  } catch (error) {
    logger.error(`Admin Update Article Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Admin: Delete article
 */
exports.deleteArticle = async (req, res) => {
  try {
    const { articleId } = req.params;

    const article = await KnowledgeBaseArticle.findByIdAndDelete(articleId);
    
    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    res.json({ 
      success: true, 
      message: 'Article deleted successfully' 
    });
  } catch (error) {
    logger.error(`Admin Delete Article Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
