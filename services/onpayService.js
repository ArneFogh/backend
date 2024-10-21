const axios = require("axios");
const { sanityClient } = require("../sanityClient");

let cursor = null;
const POLLING_INTERVAL = 10000; // Ændret til 10 sekunder for hurtigere test
const PENDING_CHECK_INTERVAL = 5 * 60 * 1000; // Ændret til 5 minutter for hurtigere test
const EVENT_AGE_LIMIT = 7 * 24 * 60 * 60 * 1000; // 7 dage i millisekunder
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

    if (
      transactionData.status === "captured" ||
      transactionData.status === "active"
    ) {
      const transactionDate = new Date(transactionData.created);
      if (new Date() - transactionDate <= EVENT_AGE_LIMIT) {
        await updateOrCreateOrder(transactionData);
      }
    } else if (
      transactionData.status === "cancelled" ||
      transactionData.status === "pre_auth"
    ) {
      console.log(
        `Ignoring transaction ${transaction} with status: ${transactionData.status}`
      );
    }

    processedTransactions.add(transaction);

    if (processedTransactions.size > 1000) {
      const iterator = processedTransactions.values();
      processedTransactions.delete(iterator.next().value);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(
        `Transaction ${transaction} not found. It may have been deleted.`
      );
    } else {
      console.error(
        `Error processing transaction ${transaction}:`,
        error.message
      );
    }
  }
}

async function updateOrCreateOrder(transactionData) {
  const orderNumber = transactionData.order_id;
  const status = transactionData.status === "captured" ? "Success" : "Pending";

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
        status: status,
        onpayDetails,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`Created new order ${orderNumber} with status: ${status}`);
    } else if (
      order.status !== status ||
      order.onpayDetails.status !== transactionData.status
    ) {
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
      `*[_type == "purchase" && status == "Pending"]`
    );

    console.log(`Checking ${pendingOrders.length} pending orders`);

    for (const order of pendingOrders) {
      try {
        const response = await axios.get(
          `https://api.onpay.io/v1/transaction/${order.onpayDetails.transactionId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.ONPAY_API_KEY}`,
              Accept: "application/json",
            },
          }
        );

        const transactionData = response.data.data;

        if (
          transactionData.status === "captured" ||
          transactionData.status === "active"
        ) {
          await updateOrCreateOrder(transactionData);
        } else if (
          ["declined", "aborted", "cancelled", "pre_auth"].includes(
            transactionData.status
          )
        ) {
          // Remove orders that are no longer pending and not captured or active
          await sanityClient.delete(order._id);
          console.log(
            `Deleted non-active/captured order: ${order.orderNumber}`
          );
        }
      } catch (error) {
        console.error(
          `Error checking order ${order.orderNumber}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("Error checking pending orders:", error.message);
  }
}

function startPolling() {
  console.log(
    `Starting Onpay transaction polling service (Interval: ${POLLING_INTERVAL}ms)...`
  );
  pollTransactionEvents();

  // Start checking pending orders periodically
  setInterval(checkPendingOrders, PENDING_CHECK_INTERVAL);
}

module.exports = { startPolling };
