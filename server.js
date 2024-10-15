require('dotenv').config();
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';


const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const gatewayId = process.env.ONPAY_GATEWAY_ID;
const secret = process.env.ONPAY_SECRET;

// Optional: Remove these console logs after confirming the values
console.log('ONPAY_GATEWAY_ID:', gatewayId);
console.log('ONPAY_SECRET:', secret ? 'Loaded' : 'Not Loaded');

function calculateHmacSha1(params, secret) {
  const sortedParams = Object.keys(params)
    .filter(key => key.startsWith('onpay_') && key !== 'onpay_hmac_sha1')
    .sort()
    .reduce((obj, key) => {
      obj[key] = params[key];
      return obj;
    }, {});

  const queryString = Object.entries(sortedParams)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
    .toLowerCase();

  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(queryString);
  return hmac.digest('hex');
}

app.post("/api/prepare-payment", (req, res) => {
  try {
    const { totalWithShipping } = req.body;
    const currency = "DKK";
    const amount = Math.round(totalWithShipping * 100).toString();
    const reference = `ORDER-${Date.now()}`;
    const acceptUrl = `${frontendUrl}/order-confirmation`;

    const params = {
      onpay_gatewayid: gatewayId,
      onpay_currency: currency,
      onpay_amount: amount,
      onpay_reference: reference,
      onpay_accepturl: acceptUrl,
    };

    console.log("Params before HMAC calculation:", params);

    const hmacSha1 = calculateHmacSha1(params, secret);

    console.log("Calculated HMAC:", hmacSha1);

    res.json({
      gatewayId: params.onpay_gatewayid,
      currency: params.onpay_currency,
      amount: params.onpay_amount,
      reference: params.onpay_reference,
      acceptUrl: params.onpay_accepturl,
      hmacSha1: hmacSha1,
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
        currency: params.onpay_currency === "208" ? "DKK" : params.onpay_currency,
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

const { sanityClient, urlFor } = require('./sanityClient');

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
    res.status(500).json({ message: "Error fetching homepage data" });
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
    return res.status(400).send('Image ID is required');
  }

  try {
    const imageUrl = urlFor(imageId).url();
    res.redirect(imageUrl);
  } catch (error) {
    console.error("Error generating image URL:", error);
    res.status(500).send('Error generating image URL');
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
    res.status(500).json({ message: "Error fetching terms and conditions data" });
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
    await sanityClient.delete({query: '*[_type == "userPost" && userId == $sanityUserId]', params: {sanityUserId}});

    // 2. Opdater køb til at fjerne referencen til brugeren
    await sanityClient
      .patch({query: '*[_type == "purchase" && user._ref == $sanityUserId]', params: {sanityUserId}})
      .unset(['user'])
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
    console.error('Error fetching products:', error);
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
    console.error('Error fetching product:', error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

const { v4: uuidv4 } = require('uuid');

// Opret eller opdater et køb
app.post("/api/purchases", async (req, res) => {
  try {
    const purchaseData = req.body;
    const { orderNumber, userId, totalAmount, currency, status, date, items } = purchaseData;

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
    res.status(500).json({ message: "Failed to create/update purchase in Sanity" });
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

app.listen(5001, () => {
  console.log("Server started on port 5001");
});
