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
  try {
    console.log("Received create post request");
    console.log("User info from request:", req.user);

    if (!req.user || !req.user.sub) {
      console.error("No user info found in request");
      return res.status(401).json({
        message: "User ID not found in request",
        debug: { user: req.user },
      });
    }

    upload.array("images", 10)(req, res, async (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ message: "Error uploading files" });
      }

      try {
        const { title, description, price } = req.body;
        const contactInfo = JSON.parse(req.body.contactInfo);
        const userId = req.user.sub; // Get user ID from req.user instead of req.auth

        console.log("Processing post with user ID:", userId);

        // Fetch user details from Sanity
        const userQuery = '*[_type == "user" && auth0Id == $auth0Id][0]';
        const userDoc = await sanityClient.fetch(userQuery, {
          auth0Id: userId,
        });

        if (!userDoc) {
          console.error("User not found in Sanity:", userId);
          return res.status(404).json({ message: "User not found" });
        }

        console.log("Found user doc:", userDoc);

        // Upload images to Sanity
        const imageAssets = await Promise.all(
          (req.files || []).map(async (file) => {
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
          userId: userId,
          createdBy: userDoc.username || userDoc.email || "Unknown User",
          createdAt: new Date().toISOString(),
        };

        console.log("Creating document with data:", {
          ...doc,
          images: `${imageAssets.length} images`,
        });

        const result = await sanityClient.create(doc);
        console.log("Post created successfully:", result._id);
        res.json(result);
      } catch (error) {
        console.error("Error in post creation:", error);
        res.status(500).json({
          message: "Failed to create user post",
          error: error.message,
        });
      }
    });
  } catch (error) {
    console.error("Controller error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

exports.deleteUserPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.sub; // Changed from req.auth to req.user

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized: User ID not found",
      });
    }

    console.log("Attempting to delete post:", { postId: id, userId });

    // First fetch the post to check ownership
    const post = await sanityClient.fetch(
      `*[_type == "userPost" && _id == $id && userId == $userId][0]`,
      {
        id,
        userId,
      }
    );

    if (!post) {
      return res.status(403).json({
        message: "Unauthorized: You can only delete your own posts",
      });
    }

    // If we reach here, the user owns the post and we can delete it
    await sanityClient.delete(id);
    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting user post:", error);
    res.status(500).json({
      message: "Failed to delete user post",
      error: error.message,
    });
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
