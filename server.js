require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { sanityClient, urlFor } = require("./sanityClient");
const {
  checkPendingOrders,
  stopPendingOrdersCheck,
} = require("./Onpay-api/orderStatusChecker");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

function validateEnvVariables() {
  const requiredEnvVars = [
    "FRONTEND_URL",
    "ONPAY_GATEWAY_ID",
    "ONPAY_SECRET",
    "SANITY_PROJECT_ID",
    "SANITY_SECRET_TOKEN",
    "BACKEND_URL",
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(
        `Error: Required environment variable ${envVar} is not set`
      );
      process.exit(1);
    }
  }
  console.log("All required environment variables are set.");
}

// Kald denne funktion før du initialiserer din Express app
validateEnvVariables();

const app = express();
checkPendingOrders();

// Environment variables
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const port = process.env.PORT || 5001;
const gatewayId = process.env.ONPAY_GATEWAY_ID;
const secret = process.env.ONPAY_SECRET;
const orderLocks = new Map();

// CORS configuration
const allowedOrigins = [
  "https://welovebirds.dk",
  "https://api.welovebirds.dk",
  "http://localhost:3000",
  "https://onpay.io",
];

// Valider miljøvariabler ved opstart
const requiredEnvVars = [
  "FRONTEND_URL",
  "ONPAY_GATEWAY_ID",
  "ONPAY_SECRET",
  "SANITY_PROJECT_ID",
  "SANITY_SECRET_TOKEN",
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Required environment variable ${envVar} is not set`);
    process.exit(1);
  }
}

// Central fejlhåndtering
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        var msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    optionsSuccessStatus: 200,
  })
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.url}`);
  next();
});

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.post("/api/update-order-status", async (req, res) => {
  const { orderNumber } = req.body;

  if (orderLocks.get(orderNumber)) {
    return res.status(409).json({ message: "Order update in progress" });
  }

  orderLocks.set(orderNumber, true);

  // Automatisk frigørelse af låsen efter 30 sekunder
  setTimeout(() => {
    orderLocks.delete(orderNumber);
  }, 30000);

  try {
    const { orderNumber, status, onpayDetails } = req.body;

    // Forsøg først at hente den eksisterende ordre
    let existingOrder = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    let updatedOrder;

    if (existingOrder) {
      // Hvis ordren eksisterer, opdater den
      updatedOrder = await sanityClient
        .patch(existingOrder._id)
        .set({
          status,
          onpayDetails,
          updatedAt: new Date().toISOString(),
        })
        .commit();
    } else {
      // Hvis ordren ikke eksisterer, opret en ny
      updatedOrder = await sanityClient.create({
        _type: "purchase",
        orderNumber,
        status,
        onpayDetails,
        totalAmount: parseInt(onpayDetails.onpay_amount) / 100,
        currency:
          onpayDetails.onpay_currency === "208"
            ? "DKK"
            : onpayDetails.onpay_currency,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    console.log("Updated order:", updatedOrder);

    res.json({ status: updatedOrder.status, orderDetails: updatedOrder });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ message: "Failed to update order status" });
  } finally {
    orderLocks.delete(orderNumber);
  }
});

app.post("/api/prepare-payment", (req, res) => {
  try {
    const { totalWithShipping, orderNumber } = req.body;
    const currency = "DKK";
    const amount = Math.round(totalWithShipping * 100).toString();
    const acceptUrl = `${process.env.FRONTEND_URL}/order-confirmation/${orderNumber}`;
    const callbackUrl = `${process.env.BACKEND_URL}/api/payment-callback`;
    const declineUrl = `${process.env.FRONTEND_URL}/payment-failed/${orderNumber}`;

    const params = {
      onpay_gatewayid: process.env.ONPAY_GATEWAY_ID,
      onpay_currency: currency,
      onpay_amount: amount,
      onpay_reference: orderNumber,
      onpay_accepturl: acceptUrl,
      onpay_callbackurl: callbackUrl,
      onpay_declineurl: declineUrl,
    };

    const hmacSha1 = calculateHmacSha1(params, process.env.ONPAY_SECRET);

    res.json({
      ...params,
      onpay_hmac_sha1: hmacSha1,
    });
  } catch (error) {
    console.error("Error in /api/prepare-payment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/verify-payment", (req, res) => {
  try {
    const queryParams = req.query;
    const params = {};
    for (let key in queryParams) {
      if (key.startsWith("onpay_") && key !== "onpay_hmac_sha1") {
        params[key] = queryParams[key];
      }
    }

    const calculatedHmac = calculateHmacSha1(params, secret);
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
    console.error("Error in /api/verify-payment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add this route to your existing server.js file
app.get("/api/homepage", async (req, res) => {
  try {
    const query = `*[_type == "homePage"][0]{
      title,
      welcomeSection,
      sections
    }`;
    const data = await sanityClient.fetch(query);
    res.json(data);
  } catch (error) {
    console.error("Error fetching homepage data:", error);
    res
      .status(500)
      .json({ message: "Error fetching homepage data", error: error.message });
  }
});

// Tilføj denne rute til din eksisterende server.js fil
app.get("/api/aboutus", async (req, res) => {
  try {
    const query = `*[_type == "aboutUs"][0]{
      title,
      introSection,
      personalStory,
      missionSection,
      gallery
    }`;
    const data = await sanityClient.fetch(query);
    res.json(data);
  } catch (error) {
    console.error("Error fetching about us data:", error);
    res.status(500).json({ message: "Error fetching about us data" });
  }
});

app.get("/api/image", async (req, res) => {
  const { imageId } = req.query;

  if (!imageId) {
    return res.status(400).send("Image ID is required");
  }

  try {
    const imageUrl = urlFor(imageId).url();
    res.redirect(imageUrl);
  } catch (error) {
    console.error("Error generating image URL:", error);
    res.status(500).send("Error generating image URL");
  }
});

// Tilføj denne rute til din eksisterende server.js fil
app.get("/api/terms", async (req, res) => {
  try {
    const query = `*[_type == "termsAndConditions"][0]{
      title,
      sections
    }`;
    const data = await sanityClient.fetch(query);
    res.json(data);
  } catch (error) {
    console.error("Error fetching terms and conditions data:", error);
    res
      .status(500)
      .json({ message: "Error fetching terms and conditions data" });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const userData = req.body;

    // Tjek om brugeren allerede eksisterer
    const existingUser = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]`,
      { auth0Id: userData.sub }
    );

    if (existingUser) {
      return res.json(existingUser);
    }

    // Hvis brugeren ikke eksisterer, opret en ny
    const result = await sanityClient.create({
      _type: "user",
      auth0Id: userData.sub,
      email: userData.email,
      username: userData.nickname || userData.name,
    });

    res.json(result);
  } catch (error) {
    console.error("Error creating/fetching user in Sanity:", error);
    res.status(500).json({ message: "Failed to create/fetch user in Sanity" });
  }
});

app.patch("/api/users/:auth0Id", async (req, res) => {
  try {
    const { auth0Id } = req.params;
    const updates = req.body;

    const result = await sanityClient
      .patch({
        query: `*[_type == "user" && auth0Id == $auth0Id][0]`,
        params: { auth0Id },
      })
      .set(updates)
      .commit();

    res.json(result);
  } catch (error) {
    console.error("Error updating user in Sanity:", error);
    res.status(500).json({ message: "Failed to update user in Sanity" });
  }
});

app.get("/api/users/:auth0Id", async (req, res) => {
  try {
    const { auth0Id } = req.params;
    const result = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]`,
      { auth0Id }
    );
    res.json(result);
  } catch (error) {
    console.error("Error fetching user from Sanity:", error);
    res.status(500).json({ message: "Failed to fetch user from Sanity" });
  }
});

app.delete("/api/users/:auth0Id", async (req, res) => {
  try {
    const { auth0Id } = req.params;

    // Først, hent Sanity bruger-ID baseret på Auth0 ID
    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]{ _id }`,
      { auth0Id }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const sanityUserId = user._id;

    // 1. Slet brugerens opslag
    await sanityClient.delete({
      query: '*[_type == "userPost" && userId == $sanityUserId]',
      params: { sanityUserId },
    });

    // 2. Opdater køb til at fjerne referencen til brugeren
    await sanityClient
      .patch({
        query: '*[_type == "purchase" && user._ref == $sanityUserId]',
        params: { sanityUserId },
      })
      .unset(["user"])
      .commit();

    // 3. Slet brugeren
    await sanityClient.delete(sanityUserId);

    res.json({ message: "User and related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting user from Sanity:", error);
    res.status(500).json({ message: "Failed to delete user from Sanity" });
  }
});

// Hent alle produkter
app.get("/api/products", async (req, res) => {
  try {
    const query = `*[_type == "product"]{
      _id,
      name,
      price,
      "imageUrl": featuredImage.asset->url
    }`;
    const products = await sanityClient.fetch(query);
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// Hent et specifikt produkt efter ID
app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = `*[_type == "product" && _id == $id][0]{
      _id,
      name,
      price,
      description,
      "images": [featuredImage.asset->url, ...images[].asset->url],
      "category": category->name,
      specifications
    }`;
    const product = await sanityClient.fetch(query, { id });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

// Opret eller opdater et køb
app.post("/api/purchases", async (req, res) => {
  try {
    const purchaseData = req.body;
    const { orderNumber, userId, totalAmount, currency, status, date, items } =
      purchaseData;

    // Find Sanity bruger-ID baseret på Auth0 ID
    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]{ _id }`,
      { auth0Id: userId }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found in Sanity" });
    }

    // Check if the purchase already exists
    const existingPurchase = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber }
    );

    if (existingPurchase) {
      return res.json(existingPurchase);
    }

    // Create a new purchase without user reference
    const newPurchase = await sanityClient.create({
      _type: "purchase",
      orderNumber,
      totalAmount,
      currency,
      status,
      date,
      purchasedItems: items.map((item) => ({
        _key: uuidv4(),
        productId: item.id,
        productName: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    // Update the user's purchases array
    await sanityClient
      .patch(user._id)
      .setIfMissing({ purchases: [] })
      .insert("after", "purchases[-1]", [
        {
          _key: uuidv4(),
          _type: "reference",
          _ref: newPurchase._id,
        },
      ])
      .commit();

    res.json(newPurchase);
  } catch (error) {
    console.error("Error creating/updating purchase in Sanity:", error);
    res
      .status(500)
      .json({ message: "Failed to create/update purchase in Sanity" });
  }
});

// Hent købshistorik for en bruger
app.get("/api/purchases/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const query = `*[_type == "purchase" && user._ref == $userId] | order(date desc) {
      _id,
      orderNumber,
      date,
      total,
      items[] {
        "product": product->{ name },
        quantity,
        price
      },
      "shippingAddress": user->{ 
        name, 
        address, 
        city, 
        postalCode, 
        country 
      },
      "billingAddress": user->{ 
        name, 
        address, 
        city, 
        postalCode, 
        country 
      }
    }`;

    const purchases = await sanityClient.fetch(query, { userId });
    res.json(purchases);
  } catch (error) {
    console.error("Error fetching purchase history:", error);
    res.status(500).json({ message: "Failed to fetch purchase history" });
  }
});

app.post("/api/create-pre-order", async (req, res) => {
  try {
    const { cartItems, shippingInfo, totalAmount } = req.body;
    const orderNumber = `ORDER-${Date.now()}`;

    const preOrder = await sanityClient.create({
      _type: "purchase",
      orderNumber: orderNumber,
      cartItems: cartItems,
      shippingInfo: shippingInfo,
      totalAmount: totalAmount,
      status: "initiated",
      createdAt: new Date().toISOString(),
    });

    res.json({ orderNumber: preOrder.orderNumber });
  } catch (error) {
    console.error("Error creating pre-order:", error);
    res.status(500).json({ message: "Failed to create pre-order" });
  }
});

app.post("/api/create-temp-order", async (req, res) => {
  try {
    const { cartItems, shippingInfo, totalAmount } = req.body;
    const orderNumber = `ORDER-${Date.now()}`;

    const tempOrder = await sanityClient.create({
      _type: "tempOrder",
      orderNumber: orderNumber,
      cartItems: cartItems,
      shippingInfo: shippingInfo,
      totalAmount: totalAmount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({ orderNumber: tempOrder.orderNumber });
  } catch (error) {
    console.error("Error creating temporary order:", error);
    res.status(500).json({ message: "Failed to create temporary order" });
  }
});

const MAX_RETRIES = 5;
const RETRY_DELAYS = [10000, 60000, 360000, 720000, 1440000]; // 10 min, 1 hour, 6 hours, 12 hours, 24 hours

app.post("/api/payment-callback", async (req, res) => {
  console.log("Received callback from OnPay:", req.body);

  // Respond immediately to OnPay
  res.status(200).send("OK");

  try {
    const result = await processCallback(req.body);
    if (result) {
      console.log("Callback processed successfully");
    } else {
      console.error("Failed to process callback");
    }
  } catch (error) {
    console.error("Error processing callback:", error);
  }
});

async function processCallback(data) {
  console.log("Processing callback data:", data);

  try {
    const {
      onpay_uuid,
      onpay_number,
      onpay_reference,
      onpay_amount,
      onpay_currency,
      onpay_errorcode,
      onpay_hmac_sha1,
    } = data;

    // Verify HMAC
    const calculatedHmac = calculateHmacSha1(data, process.env.ONPAY_SECRET);
    if (calculatedHmac !== onpay_hmac_sha1) {
      console.error("HMAC verification failed");
      throw new Error("HMAC verification failed");
    }

    const status = onpay_errorcode === "0" ? "Success" : "Failed";
    const amount = parseInt(onpay_amount) / 100; // Convert to major units

    // Check if order exists
    let order = await sanityClient.fetch(
      `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
      { orderNumber: onpay_reference }
    );

    if (order) {
      console.log(`Updating existing order: ${onpay_reference}`);
      order = await sanityClient
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
      order = await sanityClient.create({
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
    // Here you might want to implement some kind of alerting system
    // to notify you of failed callbacks
    sendAlertToTeam("Failed to process payment callback", { data, error });
    return false;
  }
}

function calculateHmacSha1(params, secret) {
  const sortedParams = Object.keys(params)
    .filter(key => key.startsWith("onpay_") && key !== "onpay_hmac_sha1")
    .sort()
    .reduce((obj, key) => {
      obj[key] = params[key];
      return obj;
    }, {});

  const queryString = Object.entries(sortedParams)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")
    .toLowerCase();

  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(queryString);
  return hmac.digest("hex");
}

function sendAlertToTeam(message, details) {
  // Implement your alert mechanism here (e.g., email, Slack notification, etc.)
  console.error("ALERT:", message, details);
}

app.get("/api/order-status/:orderNumber", async (req, res) => {
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
});

app.get("/api/order-status/:orderNumber", async (req, res) => {
  const { orderNumber } = req.params;
  const order = await sanityClient.fetch(
    `*[_type == "purchase" && orderNumber == $orderNumber][0]`,
    { orderNumber }
  );
  res.json({ status: order ? order.status : "Pending" });
});

app.post("/api/test-callback", (req, res) => {
  const testData = {
    onpay_uuid: "test-uuid",
    onpay_amount: "10000",
    onpay_currency: "208",
    onpay_reference: "TEST-" + Date.now(),
    onpay_errorcode: "0",
  };

  const hmac = calculateHmacSha1(testData, process.env.ONPAY_SECRET);
  testData.onpay_hmac_sha1 = hmac;

  fetch("https://api.welovebirds.dk/api/payment-callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testData),
  })
    .then((response) => response.text())
    .then((result) => res.send("Test callback sent. Result: " + result))
    .catch((error) => {
      console.error("Error sending test callback:", error);
      res.status(500).send("Error sending test callback");
    });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  stopPendingOrdersCheck();
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
