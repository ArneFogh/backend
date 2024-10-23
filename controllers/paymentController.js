const { sanityClient } = require("../sanityClient");
const { calculateHmacSha1, sendAlertToTeam } = require("../utils/paymentUtils");
const { v4: uuidv4 } = require("uuid");

const orderLocks = new Map();

exports.preparePayment = async (req, res) => {
  try {
    const { totalWithShipping, orderNumber, items, userId } = req.body;

    // Check om der allerede eksisterer en purchase med dette ordrenummer
    const existingPurchase = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (existingPurchase) {
      return res.status(409).json({
        message: "Order already exists",
        onPayParams: null, // eller tidligere genererede parametre hvis relevant
      });
    }

    const currency = "DKK";
    const amount = Math.round(totalWithShipping * 100).toString();

    // Find bruger
    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $userId][0]._id`,
      { userId }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Opret purchase dokument
    const purchase = await sanityClient.create({
      _type: "purchase",
      purchaseId: orderNumber,
      orderNumber: orderNumber, // Tilføj dette felt eksplicit
      status: "pending",
      totalAmount: totalWithShipping,
      currency: currency,
      createdAt: new Date().toISOString(),
      purchasedItems: items,
    });

    // Opdater bruger
    await sanityClient
      .patch(user)
      .setIfMissing({ purchases: [] })
      .append("purchases", [
        {
          _type: "reference",
          _ref: purchase._id,
        },
      ])
      .commit();

    // Forbered OnPay parametre
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

    res.json({
      ...params,
      onpay_hmac_sha1: hmacSha1,
    });
  } catch (error) {
    console.error("Error in preparePayment:", error);
    res.status(500).json({ message: "Internal server error" });
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
  const { orderNumber } = req.body;

  if (!orderNumber) {
    return res.status(400).json({ message: "Order number is required" });
  }

  try {
    const { status, onpayDetails } = req.body;

    // Find eksisterende ordre
    const existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Hvis ordren allerede har samme status, returner success uden at opdatere
    if (existingOrder.status === status) {
      return res.json({
        status: existingOrder.status,
        orderDetails: existingOrder,
      });
    }

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

    console.log("Updated order:", updatedOrder);

    res.json({ status: updatedOrder.status, orderDetails: updatedOrder });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ message: "Failed to update order status" });
  }
};

exports.handlePaymentCallback = async (req, res) => {
  console.log("Received callback from OnPay:", req.body);

  try {
    const {
      onpay_reference: purchaseId,
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

    // Find eksisterende ordre
    const purchase = await sanityClient.fetch(
      `*[_type == "purchase" && purchaseId == $purchaseId][0]`,
      { purchaseId }
    );

    if (!purchase) {
      throw new Error("Purchase not found");
    }

    // Opdater purchase status
    await sanityClient
      .patch(purchase._id)
      .set({
        status: errorCode === "0" ? "success" : "failed",
        totalAmount: parseInt(amount) / 100,
        currency: currency === "208" ? "DKK" : currency,
        updatedAt: new Date().toISOString(),
      })
      .commit();

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error processing callback:", error);
    res.status(500).send("Error");
  }
};

exports.createTempOrder = async (req, res) => {
  try {
    const { cartItems, shippingInfo, totalAmount } = req.body;
    const orderNumber = `ORDER-${Date.now()}`;

    // Check om ordren allerede eksisterer
    const existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (existingOrder) {
      return res.status(409).json({ message: "Order already exists" });
    }

    const tempOrder = {
      orderNumber,
      cartItems,
      shippingInfo,
      totalAmount,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    await sanityClient.create({
      _type: "tempOrder",
      ...tempOrder,
    });

    res.json({ orderNumber: orderNumber });
  } catch (error) {
    console.error("Error creating temporary order:", error);
    res.status(500).json({ message: "Failed to create temporary order" });
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
