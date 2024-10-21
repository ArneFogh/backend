// services/onpayService.js
const axios = require("axios");
const { sanityClient } = require("../sanityClient");

let cursor = null;
const POLLING_INTERVAL = process.env.ONPAY_POLLING_INTERVAL || 60000; // Default to 60 seconds
const EVENT_AGE_LIMIT = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const processedTransactions = new Set();

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

    const transactionDate = new Date(transactionData.created);
    if (new Date() - transactionDate > EVENT_AGE_LIMIT) {
      return;
    }

    await updateOrCreateOrder(transactionData);

    processedTransactions.add(transaction);

    if (processedTransactions.size > 1000) {
      const iterator = processedTransactions.values();
      processedTransactions.delete(iterator.next().value);
    }
  } catch (error) {
    console.error(
      `Error processing transaction ${transaction}:`,
      error.message
    );
  }
}

async function updateOrCreateOrder(transactionData) {
  const orderNumber = transactionData.order_id;
  const newStatus = mapTransactionStatusToOrderStatus(transactionData.status);

  try {
    let order = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    const now = new Date().toISOString();
    const onpayDetails = {
      transactionId: transactionData.uuid,
      amount: transactionData.amount,
      currency: transactionData.currency,
      status: transactionData.status,
    };

    if (!order) {
      order = await sanityClient.create({
        _type: "purchase",
        orderNumber: orderNumber,
        status: newStatus,
        onpayDetails,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`Created new order ${orderNumber} with status: ${newStatus}`);
    } else if (
      order.status !== newStatus ||
      order.onpayDetails.status !== transactionData.status
    ) {
      await sanityClient
        .patch(order._id)
        .set({
          status: newStatus,
          onpayDetails,
          updatedAt: now,
        })
        .commit();
      console.log(`Updated order ${orderNumber} status to ${newStatus}`);
    }
  } catch (error) {
    console.error(
      `Error updating/creating order ${orderNumber}:`,
      error.message
    );
  }
}

function mapTransactionStatusToOrderStatus(transactionStatus) {
  switch (transactionStatus) {
    case "authorized":
    case "captured":
      return "Success";
    case "declined":
    case "aborted":
      return "Failed";
    case "active":
      return "Processing";
    default:
      return "Pending";
  }
}

function startPolling() {
  console.log(
    `Starting Onpay transaction polling service (Interval: ${POLLING_INTERVAL}ms)...`
  );
  pollTransactionEvents();
}

module.exports = { startPolling };
