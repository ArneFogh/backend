require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
  checkPendingOrders,
  stopPendingOrdersCheck,
} = require("./Onpay-api/orderStatusChecker");
const paymentRoutes = require("./routes/paymentRoutes");
const { sanityClient, urlFor } = require("./sanityClient");

// Denne funktion kan blive hvor den er
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

validateEnvVariables();

const app = express();
checkPendingOrders();

// Disse variabler kan blive
const port = process.env.PORT || 5001;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

// Denne array kan blive
const allowedOrigins = [
  "https://welovebirds.dk",
  "https://api.welovebirds.dk",
  "http://localhost:3000",
  "https://onpay.io",
];

// Denne middleware-konfiguration kan blive
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

// Denne middleware kan blive
app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.url}`);
  next();
});

// Denne route kan blive
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// Brug payment routes
app.use("/api", paymentRoutes);

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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
