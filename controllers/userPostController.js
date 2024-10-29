const { sanityClient } = require("../sanityClient");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

exports.getAllUserPosts = async (req, res) => {
  try {
    const query = `*[_type == "userPost"] | order(createdAt desc) {
      _id,
      title,
      description,
      "featuredImageUrl": featuredImage.asset->url,
      "images": images[].asset->url,
      price,
      contactInfo,
      createdAt,
      userId,
      createdBy
    }`;

    const result = await sanityClient.fetch(query);
    res.json(result);
  } catch (error) {
    console.error("Error fetching user posts:", error);
    res.status(500).json({ message: "Failed to fetch user posts" });
  }
};

exports.getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const query = `*[_type == "userPost" && userId == $userId] | order(createdAt desc) {
      _id,
      title,
      description,
      "featuredImageUrl": featuredImage.asset->url,
      "images": images[].asset->url,
      price,
      contactInfo,
      createdAt,
      userId,
      createdBy
    }`;

    const result = await sanityClient.fetch(query, { userId });
    res.json(result);
  } catch (error) {
    console.error("Error fetching user posts:", error);
    res.status(500).json({ message: "Failed to fetch user posts" });
  }
};

exports.createUserPost = async (req, res) => {
  upload.array("images", 10)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: "Error uploading files" });
    }

    try {
      const { title, description, price } = req.body;
      const contactInfo = JSON.parse(req.body.contactInfo);
      const userId = req.auth?.sub; // Auth0 user ID

      // Upload images to Sanity
      const imageAssets = await Promise.all(
        req.files.map(async (file) => {
          const assetRef = await sanityClient.assets.upload(
            "image",
            file.buffer,
            {
              filename: file.originalname,
              contentType: file.mimetype,
            }
          );
          return {
            _type: "image",
            asset: {
              _type: "reference",
              _ref: assetRef._id,
            },
          };
        })
      );

      const doc = {
        _type: "userPost",
        title,
        description,
        price,
        featuredImage: imageAssets[0],
        images: imageAssets.slice(1),
        contactInfo,
        userId,
        createdAt: new Date().toISOString(),
      };

      const result = await sanityClient.create(doc);
      res.json(result);
    } catch (error) {
      console.error("Error creating user post:", error);
      res.status(500).json({ message: "Failed to create user post" });
    }
  });
};

exports.deleteUserPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.sub;

    // Check if the post exists and belongs to the user
    const post = await sanityClient.fetch(
      `*[_type == "userPost" && _id == $id && userId == $userId][0]`,
      { id, userId }
    );

    if (!post) {
      return res.status(403).json({
        message: "Unauthorized: You can only delete your own posts",
      });
    }

    await sanityClient.delete(id);
    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting user post:", error);
    res.status(500).json({ message: "Failed to delete user post" });
  }
};

exports.updateUserPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.sub;
    const updates = req.body;

    // Check if the post exists and belongs to the user
    const post = await sanityClient.fetch(
      `*[_type == "userPost" && _id == $id && userId == $userId][0]`,
      { id, userId }
    );

    if (!post) {
      return res.status(403).json({
        message: "Unauthorized: You can only update your own posts",
      });
    }

    const result = await sanityClient.patch(id).set(updates).commit();

    res.json(result);
  } catch (error) {
    console.error("Error updating user post:", error);
    res.status(500).json({ message: "Failed to update user post" });
  }
};
