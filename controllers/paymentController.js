const { sanityClient } = require("../sanityClient");
const { calculateHmacSha1, sendAlertToTeam } = require("../utils/paymentUtils");
const { v4: uuidv4 } = require("uuid");

const pendingOrders = new Map();
const orderLocks = new Map();

exports.preparePayment = async (req, res) => {
  const { orderNumber, totalWithShipping, items, userId, shippingInfo } =
    req.body;

  if (!orderNumber || !totalWithShipping || !items || !userId) {
    return res.status(400).json({
      message: "Missing required fields",
      details: "orderNumber, totalWithShipping, items, and userId are required",
    });
  }

  // Implementer mutex/locking mekanisme
  if (orderLocks.has(orderNumber)) {
    return res.status(409).json({
      message: "Order is being processed",
      status: "locked",
    });
  }

  orderLocks.set(orderNumber, true);

  try {
    // Check for existing order i Sanity
    const existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (existingOrder) {
      return res.status(409).json({
        message: "Order already exists",
        onPayParams: null,
      });
    }

    // Check for existing pending order
    if (pendingOrders.has(orderNumber)) {
      return res.status(409).json({
        message: "Order is already pending",
        onPayParams: null,
      });
    }

    // Prepare OnPay parameters
    const currency = "DKK";
    const amount = Math.round(totalWithShipping * 100).toString();

    const params = {
      onpay_gatewayid: process.env.ONPAY_GATEWAY_ID,
      onpay_currency: currency,
      onpay_amount: amount,
      onpay_reference: orderNumber,
      onpay_accepturl: `${process.env.FRONTEND_URL}/order-confirmation/${orderNumber}`,
      onpay_callbackurl: `${process.env.BACKEND_URL}/api/payment-callback`,
      onpay_declineurl: `${process.env.FRONTEND_URL}/payment-failed/${orderNumber}`,
    };

    const hmacSha1 = calculateHmacSha1(params, process.env.ONPAY_SECRET);

    // Store pending order data
    const purchase = {
      _type: "purchase",
      orderNumber,
      status: "pending",
      totalAmount: totalWithShipping,
      currency: "DKK",
      createdAt: new Date().toISOString(),
      purchasedItems: items,
      shippingInfo,
    };

    // Store i pending orders
    pendingOrders.set(orderNumber, purchase);

    // Setup cleanup after 30 minutes
    setTimeout(() => {
      pendingOrders.delete(orderNumber);
    }, 30 * 60 * 1000);

    console.log(`Stored pending order: ${orderNumber}`);

    res.json({
      ...params,
      onpay_hmac_sha1: hmacSha1,
    });
  } catch (error) {
    console.error("Error in preparePayment:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    orderLocks.delete(orderNumber);
  }
};

// Tilføj denne hjælpefunktion for at sikre valid Sanity ID
function sanitizeSanityId(id) {
  // Fjern ugyldige karakterer og erstat med understregning
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

exports.verifyPayment = (req, res) => {
  try {
    const queryParams = req.query;
    const params = {};
    for (let key in queryParams) {
      if (key.startsWith("onpay_") && key !== "onpay_hmac_sha1") {
        params[key] = queryParams[key];
      }
    }

    const calculatedHmac = calculateHmacSha1(params, process.env.ONPAY_SECRET);
    const receivedHmac = queryParams.onpay_hmac_sha1;

    if (calculatedHmac === receivedHmac) {
      const verifiedPaymentDetails = {
        amount: params.onpay_amount,
        currency:
          params.onpay_currency === "208" ? "DKK" : params.onpay_currency,
        reference: params.onpay_reference,
        status: params.onpay_errorcode === "0" ? "Success" : "Failed",
        errorCode: params.onpay_errorcode,
      };

      res.json(verifiedPaymentDetails);
    } else {
      res
        .status(400)
        .json({ status: "Failed", error: "HMAC verification failed" });
    }
  } catch (error) {
    console.error("Error in verifyPayment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateOrderStatus = async (req, res) => {
  const { orderNumber, status, onpayDetails } = req.body;
  console.log("Updating order status:", { orderNumber, status, onpayDetails });

  if (!orderNumber) {
    return res.status(400).json({ message: "Order number is required" });
  }

  try {
    // Check pending orders først
    const pendingOrder = pendingOrders.get(orderNumber);

    if (pendingOrder) {
      // Opret ordren i Sanity hvis den var pending
      const newOrder = await sanityClient.create({
        ...pendingOrder,
        status: status,
        onpayDetails,
        updatedAt: new Date().toISOString(),
      });

      // Fjern fra pending orders
      pendingOrders.delete(orderNumber);

      console.log("Created new order from pending:", newOrder);
      return res.json({
        status: newOrder.status,
        orderDetails: newOrder,
      });
    }

    // Hvis ikke i pending orders, check Sanity
    const existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (!existingOrder) {
      console.log(`No order found with number: ${orderNumber}`);
      return res.status(404).json({
        message: "Order not found",
        details: `No order found with number: ${orderNumber}`,
      });
    }

    // Opdater eksisterende ordre
    const updatedOrder = await sanityClient
      .patch(existingOrder._id)
      .set({
        status,
        onpayDetails,
        totalAmount: parseInt(onpayDetails.onpay_amount) / 100,
        currency:
          onpayDetails.onpay_currency === "208"
            ? "DKK"
            : onpayDetails.onpay_currency,
        updatedAt: new Date().toISOString(),
      })
      .commit();

    console.log("Updated existing order:", updatedOrder);

    res.json({
      status: updatedOrder.status,
      orderDetails: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      message: "Failed to update order status",
      error: error.message,
    });
  }
};

exports.handlePaymentCallback = async (req, res) => {
  console.log("Received callback from OnPay:", req.body);

  try {
    const {
      onpay_reference: orderNumber,
      onpay_amount: amount,
      onpay_currency: currency,
      onpay_errorcode: errorCode,
    } = req.body;

    // Verify HMAC
    const calculatedHmac = calculateHmacSha1(
      req.body,
      process.env.ONPAY_SECRET
    );
    if (calculatedHmac !== req.body.onpay_hmac_sha1) {
      throw new Error("Invalid HMAC");
    }

    // Check pending orders først
    const pendingOrder = pendingOrders.get(orderNumber);

    if (pendingOrder) {
      // Opret ordren i Sanity
      const purchase = await sanityClient.create({
        ...pendingOrder,
        status: errorCode === "0" ? "success" : "failed",
        totalAmount: parseInt(amount) / 100,
        currency: currency === "208" ? "DKK" : currency,
        updatedAt: new Date().toISOString(),
        onpayDetails: req.body,
      });

      // Fjern fra pending orders
      pendingOrders.delete(orderNumber);

      console.log(`Created purchase in Sanity: ${purchase._id}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error processing callback:", error);
    res.status(500).send("Error");
  }
};

exports.getOrderStatus = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const purchase = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (purchase) {
      res.json({ status: purchase.status, orderDetails: purchase });
    } else {
      const tempOrder = await sanityClient.fetch(
        `*[_type == "tempOrder" && orderNumber == $orderNumber][0]`,
        { orderNumber }
      );
      if (tempOrder) {
        res.json({ status: "pending", orderDetails: tempOrder });
      } else {
        res.status(404).json({ message: "Order not found" });
      }
    }
  } catch (error) {
    console.error("Error fetching order status:", error);
    res.status(500).json({ message: "Failed to fetch order status" });
  }
};

async function processCallback(data) {
  console.log("Processing callback data:", data);

  const { onpay_reference } = data;

  if (orderLocks.get(onpay_reference)) {
    console.log(
      `Order ${onpay_reference} is already being processed. Skipping.`
    );
    return false;
  }

  orderLocks.set(onpay_reference, true);

  try {
    const {
      onpay_uuid,
      onpay_number,
      onpay_amount,
      onpay_currency,
      onpay_errorcode,
      onpay_hmac_sha1,
    } = data;

    const calculatedHmac = calculateHmacSha1(data, process.env.ONPAY_SECRET);
    if (calculatedHmac !== onpay_hmac_sha1) {
      console.error("HMAC verification failed");
      throw new Error("HMAC verification failed");
    }

    const status = onpay_errorcode === "0" ? "Success" : "Failed";
    const amount = parseInt(onpay_amount) / 100;

    const order = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber: onpay_reference }
    );

    if (order) {
      console.log(`Updating existing order: ${onpay_reference}`);
      await sanityClient
        .patch(order._id)
        .set({
          status: status,
          totalAmount: amount,
          currency: onpay_currency === "208" ? "DKK" : onpay_currency,
          onpayDetails: {
            uuid: onpay_uuid,
            number: onpay_number,
            errorCode: onpay_errorcode,
          },
          updatedAt: new Date().toISOString(),
        })
        .commit();
    } else {
      console.log(`Creating new order: ${onpay_reference}`);
      await sanityClient.create({
        _type: "purchase",
        orderNumber: onpay_reference,
        status: status,
        totalAmount: amount,
        currency: onpay_currency === "208" ? "DKK" : onpay_currency,
        onpayDetails: {
          uuid: onpay_uuid,
          number: onpay_number,
          errorCode: onpay_errorcode,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`Order processed successfully: ${onpay_reference}`);
    return true;
  } catch (error) {
    console.error("Error processing callback:", error);
    sendAlertToTeam("Failed to process payment callback", { data, error });
    return false;
  } finally {
    orderLocks.delete(onpay_reference);
  }
}
