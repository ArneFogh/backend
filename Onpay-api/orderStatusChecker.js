const axios = require("axios");
const { sanityClient, urlFor } = require("../sanityClient"); // Juster stien hvis nødvendigt

async function checkPendingOrders() {
  console.log(`[${new Date().toISOString()}] Starting pending orders check...`);
  try {
    const pendingOrders = await sanityClient.fetch(
      `*[_type == "purchase" && (status == "pending" || status == null)]`
    );

    console.log(`Found ${pendingOrders.length} pending orders.`);

    for (const order of pendingOrders) {
      console.log(`Checking status for order: ${order.orderNumber}`);
      const status = await checkOrderStatusWithOnPay(order.orderNumber);

      if (status !== "pending") {
        console.log(`Updating order ${order.orderNumber} status to ${status}`);
        await updateOrderStatus(order._id, status);
      } else {
        console.log(`Order ${order.orderNumber} is still pending.`);
      }
    }

    console.log(`[${new Date().toISOString()}] Finished pending orders check.`);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error checking pending orders:`,
      error
    );
  }
}

async function checkOrderStatusWithOnPay(orderNumber) {
  try {
    const response = await axios.get(
      `https://api.onpay.io/v1/transaction/${orderNumber}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ONPAY_API_KEY}`,
          Accept: "application/json",
        },
      }
    );

    return response.data.data.status;
  } catch (error) {
    console.error(
      `Error checking order status with OnPay for order ${orderNumber}:`,
      error
    );
    return "pending"; // Assume pending if we can't check
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await sanityClient
      .patch(orderId)
      .set({ status: status, updatedAt: new Date().toISOString() })
      .commit();
    console.log(`Successfully updated order ${orderId} status to ${status}`);
  } catch (error) {
    console.error(`Error updating order ${orderId} status:`, error);
    throw error;
  }
}

function sendAlertToTeam(message, details) {
  // Implement your alert mechanism here (e.g., email, Slack notification, etc.)
  console.error("ALERT:", message, details);
}

// Run the check every minute
const checkInterval = setInterval(checkPendingOrders, 60 * 1000);

// Optional: Add a function to stop the interval (useful for testing or cleanup)
function stopPendingOrdersCheck() {
  clearInterval(checkInterval);
  console.log("Stopped pending orders check interval.");
}

// Initial check on startup
checkPendingOrders();

module.exports = { checkPendingOrders, stopPendingOrdersCheck };
