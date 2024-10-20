const cors = require("cors");

const allowedOrigins = [
  "https://welovebirds.dk",
  "https://api.welovebirds.dk",
  "http://localhost:3000",
  "https://onpay.io",
  "https://welovebirdssanity.sanity.studio", // Tilføjet for Sanity
];

module.exports = cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg =
        "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
});
