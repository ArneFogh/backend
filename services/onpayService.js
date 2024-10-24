const axios = require("axios");
const { sanityClient } = require("../sanityClient");

let cursor = null;
const POLLING_INTERVAL = 60000; // 1 minute
const PENDING_CHECK_INTERVAL = 60000; //5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const processedTransactions = new Set();

async function processPayment(paymentData, retry = 0) {
  const { onpay_reference: orderNumber, onpay_uuid: transactionId } =
    paymentData;

  try {
    // Check if order already exists in Sanity
    const existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (existingOrder) {
      console.log(`Order ${orderNumber} already exists, skipping processing`);
      return;
    }

    // Get temp order
    const tempOrder = await sanityClient.fetch(
      `*[_type == "tempOrder" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (!tempOrder) {
      console.error(`No temp order found for ${orderNumber}`);
      return;
    }

    // Create permanent order with updated schema
    const purchase = {
      _type: "purchase",
      orderNumber,
      status: paymentData.onpay_errorcode === "0" ? "authorized" : "failed",
      totalAmount: parseInt(paymentData.onpay_amount) / 100,
      currency:
        paymentData.onpay_currency === "208"
          ? "DKK"
          : paymentData.onpay_currency,
      purchasedItems: tempOrder.items,
      shippingInfo: tempOrder.shippingInfo,
      billingInfo: tempOrder.sameAsShipping
        ? tempOrder.shippingInfo
        : tempOrder.billingInfo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      onpayTransactionId: transactionId,
      onpayDetails: {
        uuid: transactionId,
        method: paymentData.onpay_method || paymentData.onpay_wallet || "card",
      },
    };

    // Use a transaction to ensure atomicity
    await sanityClient
      .transaction()
      .create(purchase)
      .delete(tempOrder._id)
      .commit();

    console.log(`Successfully processed order ${orderNumber}`);
  } catch (error) {
    console.error(`Error processing payment for order ${orderNumber}:`, error);

    if (retry < MAX_RETRIES) {
      console.log(
        `Retrying payment processing for order ${orderNumber} (attempt ${
          retry + 1
        })`
      );
      setTimeout(
        () => processPayment(paymentData, retry + 1),
        5000 * (retry + 1)
      );
    } else {
      sendAlertToTeam("Failed to process payment after max retries", {
        orderNumber,
        error: error.message,
      });
    }
  }
}

async function pollTransactionEvents() {
  try {
    const params = cursor ? { cursor } : {};
    const response = await axios.get(
      "https://api.onpay.io/v1/transaction/events/",
      {
        params,
        headers: {
          Authorization: `Bearer ${process.env.ONPAY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const { data: events, meta } = response.data;

    for (const event of events) {
      await handleTransactionEvent(event);
    }

    cursor = meta.next_cursor;
  } catch (error) {
    console.error("Error polling transaction events:", error.message);
  } finally {
    setTimeout(pollTransactionEvents, POLLING_INTERVAL);
  }
}

async function handleTransactionEvent(event) {
  const { transaction } = event;

  if (processedTransactions.has(transaction)) {
    return;
  }

  try {
    const transactionResponse = await axios.get(
      `https://api.onpay.io/v1/transaction/${transaction}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ONPAY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const transactionData = transactionResponse.data.data;
    const purchaseId = transactionData.order_id;

    // Find purchase i Sanity
    const purchase = await sanityClient.fetch(
      `*[_type == "purchase" && purchaseId == $purchaseId][0]`,
      { purchaseId }
    );

    if (purchase) {
      // Opdater purchase status baseret på transaction status
      await sanityClient
        .patch(purchase._id)
        .set({
          status:
            transactionData.status === "captured"
              ? "success"
              : transactionData.status === "declined"
              ? "failed"
              : "pending",
          updatedAt: new Date().toISOString(),
        })
        .commit();
    }

    processedTransactions.add(transaction);
  } catch (error) {
    console.error("Error handling transaction:", error);
  }
}

async function updateOrCreateOrder(transactionData) {
  const orderNumber = transactionData.order_id;
  const status =
    transactionData.status === "captured" ? "captured" : "authorized";

  try {
    let order = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    const now = new Date().toISOString();
    const onpayDetails = {
      uuid: transactionData.uuid,
      method: transactionData.wallet || "card",
    };

    if (!order) {
      // Get temp order for shipping and billing info
      const tempOrder = await sanityClient.fetch(
        `*[_type == "tempOrder" && orderNumber == $orderNumber][0]`
      );

      if (!tempOrder) {
        console.error(`No temp order found for ${orderNumber}`);
        return;
      }

      order = await sanityClient.create({
        _type: "purchase",
        orderNumber: orderNumber,
        status: status,
        totalAmount: parseInt(transactionData.amount) / 100,
        currency:
          transactionData.currency_code === "208"
            ? "DKK"
            : transactionData.currency_code,
        purchasedItems: tempOrder.items,
        shippingInfo: tempOrder.shippingInfo,
        billingInfo: tempOrder.sameAsShipping
          ? tempOrder.shippingInfo
          : tempOrder.billingInfo,
        onpayTransactionId: transactionData.uuid,
        onpayDetails,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`Created new order ${orderNumber} with status: ${status}`);
    } else if (order.status !== status) {
      await sanityClient
        .patch(order._id)
        .set({
          status: status,
          onpayDetails,
          updatedAt: now,
        })
        .commit();
      console.log(`Updated order ${orderNumber} status to ${status}`);
    }
  } catch (error) {
    console.error(
      `Error updating/creating order ${orderNumber}:`,
      error.message
    );
  }
}

async function checkPendingOrders() {
  try {
    const pendingOrders = await sanityClient.fetch(
      `*[_type == "tempOrder" && dateTime(expiresAt) > dateTime(now())]`
    );

    console.log(`\nChecking ${pendingOrders.length} pending orders`);

    for (const order of pendingOrders) {
      try {
        console.log(`\nChecking order: ${order.orderNumber}`);

        const transactionsResponse = await axios.get(
          "https://api.onpay.io/v1/transaction/",
          {
            params: {
              query: order.orderNumber,
            },
            headers: {
              Authorization: `Bearer ${process.env.ONPAY_API_KEY}`,
              Accept: "application/json",
            },
          }
        );

        const transaction = transactionsResponse.data.data.find((tx) => {
          const isMatch =
            tx.order_id === order.orderNumber &&
            tx.status === "active" &&
            !tx.charged;

          console.log("Checking transaction:", {
            transactionId: tx.uuid,
            orderId: tx.order_id,
            status: tx.status,
            charged: tx.charged,
            isMatch,
          });

          return isMatch;
        });

        if (transaction) {
          console.log(
            `Found matching transaction for order ${order.orderNumber}:`,
            transaction
          );

          // Create permanent order with updated schema
          const purchase = {
            _type: "purchase",
            orderNumber: order.orderNumber,
            status: "authorized",
            totalAmount: parseInt(transaction.amount) / 100,
            currency: "DKK",
            purchasedItems: order.items,
            shippingInfo: order.shippingInfo,
            billingInfo: order.sameAsShipping
              ? order.shippingInfo
              : order.billingInfo,
            onpayTransactionId: transaction.uuid,
            onpayDetails: {
              uuid: transaction.uuid,
              method: transaction.wallet || "card",
            },
            createdAt: order.createdAt,
            updatedAt: new Date().toISOString(),
          };

          // Atomic operation
          await sanityClient
            .transaction()
            .create(purchase)
            .delete(order._id)
            .commit();

          console.log(`Created purchase order: ${order.orderNumber}`);
        } else {
          console.log(
            `No matching transaction found for order: ${order.orderNumber}`
          );
        }
      } catch (error) {
        console.error(`Error checking order ${order.orderNumber}:`, error);
        if (error.response) {
          console.error("OnPay API response:", error.response.data);
        }
      }
    }

    // Cleanup
    const expired = await sanityClient.fetch(
      `*[_type == "tempOrder" && dateTime(expiresAt) <= dateTime(now())]`
    );

    if (expired.length > 0) {
      await sanityClient.delete({
        query: `*[_type == "tempOrder" && dateTime(expiresAt) <= dateTime(now())]`,
      });
      console.log(`\nCleaned up ${expired.length} expired orders`);
    }
  } catch (error) {
    console.error("\nError in checkPendingOrders:", error);
  }
}

function startPolling() {
  console.log("Starting payment monitoring service...");

  // Start checking pending orders periodically
  setInterval(checkPendingOrders, PENDING_CHECK_INTERVAL);

  // Initial check
  checkPendingOrders();
}

module.exports = { startPolling, processPayment };
