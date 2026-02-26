const express = require('express');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const ratingController = require('./rating.controller');

const router = express.Router();

// Allow authenticated users to view
router.use(authenticate);

// Only 'user' (client) can submit a rating
router.post('/submit', authorize('user'), ratingController.submitRating);
router.get('/worker/:workerId', ratingController.getWorkerRatings);

module.exports = router;
