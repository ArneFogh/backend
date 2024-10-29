const express = require('express');
const router = express.Router();
const userPostController = require('../controllers/userPostController');
const { checkJwt } = require('../middleware/auth');

// Public routes
router.get('/', userPostController.getAllUserPosts);
router.get('/user/:userId', userPostController.getUserPosts);

// Protected routes - kræver valid Auth0 token
router.post('/', checkJwt, userPostController.createUserPost);
router.delete('/:id', checkJwt, userPostController.deleteUserPost);
router.patch('/:id', checkJwt, userPostController.updateUserPost);

module.exports = router;