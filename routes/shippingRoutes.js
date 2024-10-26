// routes/shippingRoutes.js
const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shippingController');

router.get('/shipping-settings', shippingController.getShippingSettings);

module.exports = router;