const crypto = require("crypto");

exports.calculateHmacSha1 = (params, secret) => {
  const sortedParams = Object.keys(params)
    .filter((key) => key.startsWith("onpay_") && key !== "onpay_hmac_sha1")
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
};

exports.sendAlertToTeam = (message, details) => {
  // Implement your alert mechanism here (e.g., email, Slack notification, etc.)
  console.error("ALERT:", message, details);
};
