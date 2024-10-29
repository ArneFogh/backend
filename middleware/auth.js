// middleware/auth.js
const { auth } = require('express-oauth2-jwt-bearer');
const { expressjwt: jwt } = require('express-jwt');
const jwks = require('jwks-rsa');

// Setup auth middleware
const checkJwt = jwt({
  secret: jwks.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
  }),
  audience: process.env.AUTH0_AUDIENCE,
  issuer: `https://${process.env.AUTH0_DOMAIN}/`,
  algorithms: ['RS256']
});

// Error handling middleware
const handleAuthError = (err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    res.status(401).json({ message: 'Invalid token' });
  } else {
    next(err);
  }
};

module.exports = { checkJwt, handleAuthError };