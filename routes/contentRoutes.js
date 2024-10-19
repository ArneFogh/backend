const express = require('express');
const router = express.Router();
const contentController = require('../controllers/contentController');

router.get('/homepage', contentController.getHomepage);
router.get('/aboutus', contentController.getAboutUs);
router.get('/terms', contentController.getTerms);
router.get('/image', contentController.getImage);

module.exports = router;