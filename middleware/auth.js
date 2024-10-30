const { auth } = require("express-oauth2-jwt-bearer");
const jwt = require("jsonwebtoken");

const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  tokenSigningAlg: "RS256",
});

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

  try {
    // Decode token to get user info without verifying (verification is done by checkJwt)
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.sub) {
      console.log("Invalid token structure:", decoded);
      return res.status(401).json({ message: "Invalid token structure" });
    }

    // Store only the necessary information
    req.user = {
      sub: decoded.sub,
      scope: decoded.scope,
    };

    console.log("Token decoded successfully:", {
      sub: decoded.sub,
      scope: decoded.scope,
    });

    next();
  } catch (error) {
    console.error("Error decoding token:", error);
    return res.status(401).json({ message: "Invalid token format" });
  }
};

const handleAuthError = (err, req, res, next) => {
  console.error("Auth Error:", {
    name: err.name,
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
  });

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      message: "Invalid token",
      error: err.message,
    });
  }
  next(err);
};

module.exports = { checkJwt, extractAuthToken, handleAuthError };
