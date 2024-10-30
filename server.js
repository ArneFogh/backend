require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { auth } = require("express-oauth2-jwt-bearer");
const bodyParser = require("body-parser");
const { validateEnvVariables } = require("./config/envConfig");
const corsMiddleware = require("./middleware/corsMiddleware");
const loggingMiddleware = require("./middleware/loggingMiddleware");
const { handleAuthError } = require("./middleware/auth");
const onpayService = require("./services/onpayService");

const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const contentRoutes = require("./routes/contentRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const shippingRoutes = require("./routes/shippingRoutes");
const userPostRoutes = require("./routes/userPostRoutes");

validateEnvVariables();

const app = express();

const port = process.env.PORT || 5000;

// Middleware
app.use((req, res, next) => {
  if (req.path === "/api/payment-callback") {
    next(); // Spring CORS-middleware over
  } else {
    corsMiddleware(req, res, next);
  }
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(loggingMiddleware);
app.use(express.urlencoded({ extended: true }));

// Routes
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api", contentRoutes);
app.use("/api", paymentRoutes);
app.use("/api", shippingRoutes);
app.use("/api/user-posts", userPostRoutes);
app.use(handleAuthError);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ message: "Invalid token" });
  }
  res.status(500).json({ message: "Something broke!" });
});

// Process handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Start server
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  onpayService.startPolling();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
