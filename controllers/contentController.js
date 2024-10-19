const { sanityClient, urlFor } = require('../sanityClient');

exports.getHomepage = async (req, res) => {
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
    res.status(500).json({ message: "Error fetching homepage data", error: error.message });
  }
};

exports.getAboutUs = async (req, res) => {
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
};

exports.getTerms = async (req, res) => {
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
};

exports.getImage = async (req, res) => {
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
};