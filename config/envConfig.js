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
        console.error(`Error: Required environment variable ${envVar} is not set`);
        process.exit(1);
      }
    }
    console.log("All required environment variables are set.");
  }
  
  module.exports = { validateEnvVariables };