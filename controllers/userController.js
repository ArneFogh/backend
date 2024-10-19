const { sanityClient } = require("../sanityClient");
const { v4: uuidv4 } = require("uuid");

exports.createUser = async (req, res) => {
  try {
    const userData = req.body;
    const existingUser = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]`,
      { auth0Id: userData.sub }
    );
    if (existingUser) {
      return res.json(existingUser);
    }
    const result = await sanityClient.create({
      _type: "user",
      auth0Id: userData.sub,
      email: userData.email,
      username: userData.nickname || userData.name,
    });
    res.json(result);
  } catch (error) {
    console.error("Error creating/fetching user in Sanity:", error);
    res.status(500).json({ message: "Failed to create/fetch user in Sanity" });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { auth0Id } = req.params;
    const updates = req.body;

    const result = await sanityClient
      .patch({
        query: `*[_type == "user" && auth0Id == $auth0Id][0]`,
        params: { auth0Id },
      })
      .set(updates)
      .commit();

    res.json(result);
  } catch (error) {
    console.error("Error updating user in Sanity:", error);
    res.status(500).json({ message: "Failed to update user in Sanity" });
  }
};

exports.getUser = async (req, res) => {
  try {
    const { auth0Id } = req.params;
    const result = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]`,
      { auth0Id }
    );
    if (!result) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(result);
  } catch (error) {
    console.error("Error fetching user from Sanity:", error);
    res.status(500).json({ message: "Failed to fetch user from Sanity" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { auth0Id } = req.params;

    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]{ _id }`,
      { auth0Id }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const sanityUserId = user._id;

    // 1. Slet brugerens opslag
    await sanityClient.delete({
      query: '*[_type == "userPost" && userId == $sanityUserId]',
      params: { sanityUserId },
    });

    // 2. Opdater køb til at fjerne referencen til brugeren
    await sanityClient
      .patch({
        query: '*[_type == "purchase" && user._ref == $sanityUserId]',
        params: { sanityUserId },
      })
      .unset(["user"])
      .commit();

    // 3. Slet brugeren
    await sanityClient.delete(sanityUserId);

    res.json({ message: "User and related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting user from Sanity:", error);
    res.status(500).json({ message: "Failed to delete user from Sanity" });
  }
};
