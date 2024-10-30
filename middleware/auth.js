const { auth } = require("express-oauth2-jwt-bearer");

const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  tokenSigningAlg: "RS256",
});

// Middleware to extract the auth token
const extractAuthToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log("No Authorization header present");
    return res.status(401).json({ message: "No authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.log("No token found in Authorization header");
    return res.status(401).json({ message: "No token provided" });
  }

  console.log("Token extracted successfully");
  req.token = token;
  next();
};

// Error handling middleware
const handleAuthError = (err, req, res, next) => {
  console.error("Auth Error:", err);
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      message: "Invalid token",
      error: err.message,
    });
  }
  next(err);
};

module.exports = { checkJwt, extractAuthToken, handleAuthError };
