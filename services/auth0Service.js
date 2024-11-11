const axios = require("axios");

class Auth0Service {
  constructor() {
    // Check environment variables on initialization
    const requiredEnvVars = [
      "AUTH0_DOMAIN",
      "AUTH0_MANAGEMENT_CLIENT_ID",
      "AUTH0_MANAGEMENT_CLIENT_SECRET",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );

    if (missingVars.length > 0) {
      console.error("Missing required environment variables:", missingVars);
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    this.domain = process.env.AUTH0_DOMAIN;
    this.clientId = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
    this.clientSecret = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET;
    this.managementToken = null;
    this.tokenExpiresAt = null;

    // Log configuration on initialization (safely)
    console.log("Auth0Service initialized with:", {
      domain: this.domain,
      clientId: this.clientId,
      clientSecret: this.clientSecret
        ? `${this.clientSecret.substr(0, 3)}...${this.clientSecret.substr(-3)}`
        : "NOT SET",
      secretLength: this.clientSecret ? this.clientSecret.length : 0,
    });
  }

  async getManagementToken() {
    try {
      console.log("Requesting management token with:", {
        domain: this.domain,
        clientId: this.clientId,
        hasSecret: !!this.clientSecret,
        secretLength: this.clientSecret ? this.clientSecret.length : 0,
      });

      const response = await axios.post(
        `https://${this.domain}/oauth/token`,
        {
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          audience: `https://${this.domain}/api/v2/`,
        },
        {
          headers: { "content-type": "application/json" },
        }
      );

      this.managementToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;

      console.log("Successfully obtained management token");
      return this.managementToken;
    } catch (error) {
      console.error("Error getting management token:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        error: error.response?.data,
        requestData: {
          url: `https://${this.domain}/oauth/token`,
          grant_type: "client_credentials",
          client_id: this.clientId,
          audience: `https://${this.domain}/api/v2/`,
        },
      });

      throw new Error(
        `Failed to get Auth0 management token: ${
          error.response?.data?.error_description || error.message
        }`
      );
    }
  }

  async deleteUser(userId) {
    try {
      console.log("Starting delete process for user:", userId);
      const token = await this.getManagementToken();

      console.log("Got management token, attempting delete...");

      const response = await axios.delete(
        `https://${this.domain}/api/v2/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Successfully deleted user from Auth0");
      return true;
    } catch (error) {
      console.error("Error deleting user:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        error: error.response?.data,
        userId,
      });

      throw new Error(
        `Failed to delete Auth0 user: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  }
}

module.exports = new Auth0Service();
