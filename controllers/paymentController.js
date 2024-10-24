const { sanityClient } = require("../sanityClient");
const { calculateHmacSha1, sendAlertToTeam } = require("../utils/paymentUtils");
const ORDER_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
const { v4: uuidv4 } = require("uuid");

const pendingOrders = new Map();
const orderLocks = new Map();

function mapPaymentStatus(status, errorCode) {
  if (errorCode === "0" || status === "Success") {
    return "authorized";
  } else if (status === "captured") {
    return "captured";
  } else if (status === "declined") {
    return "cancelled";
  } else {
    return "failed";
  }
}

function formatOnpayDetails(rawDetails) {
  return {
    uuid: rawDetails.onpay_uuid,
    method: rawDetails.onpay_method || rawDetails.onpay_wallet || "card", // Fallback til 'card' hvis ingen metode er specificeret
  };
}

exports.preparePayment = async (req, res) => {
  const {
    orderNumber,
    totalWithShipping,
    items,
    userId,
    shippingInfo,
    billingInfo,
    sameAsShipping,
  } = req.body;

  try {
    const formattedOrderNumber = orderNumber.toUpperCase();

    const params = {
      onpay_gatewayid: process.env.ONPAY_GATEWAY_ID,
      onpay_currency: "208",
      onpay_amount: Math.round(totalWithShipping * 100).toString(),
      onpay_reference: formattedOrderNumber,
      onpay_accepturl: `${process.env.FRONTEND_URL}/order-confirmation/${formattedOrderNumber}`,
      onpay_callbackurl: `${process.env.BACKEND_URL}/api/payment-callback`,
      onpay_declineurl: `${process.env.FRONTEND_URL}/payment-failed/${formattedOrderNumber}`,
    };

    const hmacSha1 = calculateHmacSha1(params, process.env.ONPAY_SECRET);

    // Opret tempOrder med alle påkrævede felter inklusive billing information
    const tempOrder = {
      _type: "tempOrder",
      orderNumber: formattedOrderNumber,
      status: "pending",
      items: items.map((item) => ({
        _key: item._key || uuidv4(),
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
      })),
      totalAmount: totalWithShipping,
      userId,
      shippingInfo: {
        fullName: shippingInfo.fullName,
        address: shippingInfo.address,
        city: shippingInfo.city,
        postalCode: shippingInfo.postalCode,
        email: shippingInfo.email,
        country: shippingInfo.country,
      },
      billingInfo: {
        fullName: billingInfo.fullName,
        address: billingInfo.address,
        city: billingInfo.city,
        postalCode: billingInfo.postalCode,
        email: billingInfo.email,
        country: billingInfo.country,
      },
      sameAsShipping,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ORDER_EXPIRY_TIME).toISOString(),
    };

    await sanityClient.create(tempOrder);

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

  try {
    const order = await sanityClient.fetch(
      `*[(_type == "tempOrder" || _type == "purchase") && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (!order) {
      console.log(`No order found with number: ${orderNumber}`);
      return res.status(404).json({
        message: "Order not found",
        details: `No order found with number: ${orderNumber}`,
      });
    }

    const mappedStatus = mapPaymentStatus(
      status,
      onpayDetails?.onpay_errorcode
    );
    const formattedOnpayDetails = formatOnpayDetails(onpayDetails);

    if (order._type === "tempOrder") {
      // Hent bruger ID fra tempOrder
      const userId = order.userId;

      // Hent bruger dokument fra Sanity
      const user = await sanityClient.fetch(
        `*[_type == "user" && auth0Id == $userId][0]`,
        { userId }
      );

      if (!user) {
        console.log(`No user found for ID: ${userId}`);
        return res.status(404).json({ message: "User not found" });
      }

      // Generer purchaseId
      const purchaseId = `P${Date.now()}`;

      const purchase = {
        _type: "purchase",
        purchaseId: purchaseId, // Auto-genereret sekventielt ordre ID
        orderNumber: orderNumber,
        onpayTransactionId: onpayDetails.onpay_uuid, // Unikt transaktions ID fra OnPay
        status: mappedStatus,
        totalAmount: parseInt(onpayDetails.onpay_amount) / 100,
        currency:
          onpayDetails.onpay_currency === "208"
            ? "DKK"
            : onpayDetails.onpay_currency,
        purchasedItems: order.items,
        shippingInfo: order.shippingInfo,
        billingInfo: order.billingInfo,
        onpayDetails: formattedOnpayDetails,
        createdAt: order.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // Opret purchase dokument
      const createdPurchase = await sanityClient.create(purchase);

      console.log("Created purchase document:", createdPurchase);

      // Opdater user med reference til det nye purchase dokument
      await sanityClient
        .patch(user._id)
        .setIfMissing({ purchases: [] })
        .append("purchases", [
          {
            _key: purchaseId, // Brug purchaseId som _key
            _type: "reference",
            _ref: createdPurchase._id, // createdPurchase._id indeholder nu det korrekte Sanity dokument ID
          },
        ])
        .commit();

      console.log(
        `Updated user ${user._id} with purchase reference to ${createdPurchase._id}`
      );

      // Slet temp order
      await sanityClient.delete(order._id);

      return res.json({
        status: mappedStatus,
        orderDetails: createdPurchase,
      });
    } else {
      const updatedOrder = await sanityClient
        .patch(order._id)
        .set({
          status: mappedStatus,
          onpayDetails: formattedOnpayDetails,
          updatedAt: new Date().toISOString(),
        })
        .commit();

      console.log("Updated existing order:", updatedOrder);

      return res.json({
        status: updatedOrder.status,
        orderDetails: updatedOrder,
      });
    }
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
    const { onpay_reference: orderNumber } = req.body;

    const calculatedHmac = calculateHmacSha1(
      req.body,
      process.env.ONPAY_SECRET
    );
    if (calculatedHmac !== req.body.onpay_hmac_sha1) {
      throw new Error("Invalid HMAC");
    }

    const success = await processPaymentCallback(req.body);
    if (success) {
      res.status(200).send("OK");
    } else {
      res.status(500).send("Processing failed");
    }
  } catch (error) {
    console.error("Error processing callback:", error);
    res.status(500).send("Error");
  }
};

async function processPaymentCallback(data) {
  const { onpay_reference: orderNumber } = data;

  try {
    // Find temp order
    const tempOrder = await sanityClient.fetch(
      `*[_type == "tempOrder" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (!tempOrder) {
      console.log(`No temp order found for ${orderNumber}`);
      return false;
    }

    // Find user
    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $userId][0]`,
      { userId: tempOrder.userId }
    );

    if (!user) {
      console.log(`No user found for ID: ${tempOrder.userId}`);
      return false;
    }

    const purchase = {
      _type: "purchase",
      orderNumber,
      status: data.onpay_errorcode === "0" ? "authorized" : "failed",
      totalAmount: parseInt(data.onpay_amount) / 100,
      currency: data.onpay_currency === "208" ? "DKK" : data.onpay_currency,
      purchasedItems: tempOrder.items,
      shippingInfo: tempOrder.shippingInfo,
      billingInfo: tempOrder.billingInfo,
      onpayDetails: {
        uuid: data.onpay_uuid,
        method: data.onpay_method || data.onpay_wallet || "card",
      },
      createdAt: tempOrder.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Brug transaction til at sikre atomisk operation
    const transaction = sanityClient.transaction();

    // Opret purchase
    const createdPurchase = await transaction.create(purchase).commit();

    // Opdater user med reference til purchase
    await sanityClient
      .patch(user._id)
      .setIfMissing({ purchases: [] })
      .append("purchases", [
        {
          _type: "reference",
          _ref: createdPurchase._id,
          _key: `purchase-${Date.now()}`,
        },
      ])
      .commit();

    // Slet temp order
    await sanityClient.delete(tempOrder._id);

    console.log(`Successfully processed payment for order ${orderNumber}`);
    return true;
  } catch (error) {
    console.error(`Error processing payment for ${orderNumber}:`, error);
    return false;
  }
}

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
    const calculatedHmac = calculateHmacSha1(data, process.env.ONPAY_SECRET);
    if (calculatedHmac !== data.onpay_hmac_sha1) {
      console.error("HMAC verification failed");
      throw new Error("HMAC verification failed");
    }

    const mappedStatus = mapPaymentStatus(null, data.onpay_errorcode);
    const amount = parseInt(data.onpay_amount) / 100;
    const formattedOnpayDetails = formatOnpayDetails(data);

    const order = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber: onpay_reference }
    );

    if (order) {
      console.log(`Updating existing order: ${onpay_reference}`);
      await sanityClient
        .patch(order._id)
        .set({
          status: mappedStatus,
          totalAmount: amount,
          currency: data.onpay_currency === "208" ? "DKK" : data.onpay_currency,
          onpayDetails: formattedOnpayDetails,
          updatedAt: new Date().toISOString(),
        })
        .commit();
    } else {
      console.log(`Creating new order: ${onpay_reference}`);
      await sanityClient.create({
        _type: "purchase",
        orderNumber: onpay_reference,
        status: mappedStatus,
        totalAmount: amount,
        currency: data.onpay_currency === "208" ? "DKK" : data.onpay_currency,
        onpayDetails: formattedOnpayDetails,
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
