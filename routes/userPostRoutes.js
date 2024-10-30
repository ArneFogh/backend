const express = require("express");
const router = express.Router();
const userPostController = require("../controllers/userPostController");
const { checkJwt, extractAuthToken } = require("../middleware/auth");

// Public routes
router.get("/", userPostController.getAllUserPosts);
router.get("/user/:userId", userPostController.getUserPosts);

// Protected routes
router.post("/", extractAuthToken, checkJwt, userPostController.createUserPost);
router.delete(
  "/:id",
  extractAuthToken,
  checkJwt,
  userPostController.deleteUserPost
);
router.patch(
  "/:id",
  extractAuthToken,
  checkJwt,
  userPostController.updateUserPost
);

module.exports = router;
