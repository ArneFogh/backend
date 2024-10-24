const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/prepare-payment", paymentController.preparePayment);
router.get("/verify-payment", paymentController.verifyPayment);
router.post("/update-order-status", paymentController.updateOrderStatus);
router.post("/payment-callback", paymentController.handlePaymentCallback);
router.get("/order-status/:orderNumber", paymentController.getOrderStatus);

module.exports = router;
