// controllers/shippingController.js
const { sanityClient } = require('../sanityClient');

exports.getShippingSettings = async (req, res) => {
  try {
    const query = `*[_type == "shippingSettings" && isActive == true][0]{
      shippingCost,
      freeShippingThreshold
    }`;
    const settings = await sanityClient.fetch(query);
    
    if (!settings) {
      return res.json({
        shippingCost: 0,
        freeShippingThreshold: 0
      });
    }
    
    res.json(settings);
  } catch (error) {
    console.error("Error fetching shipping settings:", error);
    res.status(500).json({ message: "Failed to fetch shipping settings" });
  }
};