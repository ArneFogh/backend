require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const {
  checkPendingOrders,
  stopPendingOrdersCheck,
} = require("./Onpay-api/orderStatusChecker");
const { validateEnvVariables } = require("./config/envConfig");
const corsMiddleware = require("./middleware/corsMiddleware");
const loggingMiddleware = require("./middleware/loggingMiddleware");

const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const contentRoutes = require("./routes/contentRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

validateEnvVariables();

const app = express();
checkPendingOrders();

const port = process.env.PORT || 5001;

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

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api", contentRoutes);
app.use("/api", paymentRoutes);

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  stopPendingOrdersCheck();
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
