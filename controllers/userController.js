const { sanityClient } = require("../sanityClient");
const Auth0Service = require("../services/auth0Service");

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

    // 1. Find brugeren i Sanity
    const user = await sanityClient.fetch(
      `*[_type == "user" && auth0Id == $auth0Id][0]{ 
        _id,
        auth0Id,
        email 
      }`,
      { auth0Id }
    );

    if (!user) {
      console.log("User not found in Sanity:", auth0Id);
      return res.status(404).json({ message: "User not found" });
    }

    const sanityUserId = user._id;

    try {
      // 2. Slet brugeren fra Auth0
      await Auth0Service.deleteUser(auth0Id);
      console.log("User deleted from Auth0 successfully:", auth0Id);
    } catch (auth0Error) {
      console.error("Error deleting user from Auth0:", auth0Error);
      return res.status(500).json({
        message: "Failed to delete user from Auth0",
        error: auth0Error.message,
      });
    }

    // 3. Hvis Auth0 sletning lykkedes, fortsæt med Sanity sletning
    // Slet alle brugerens opslag
    const posts = await sanityClient.fetch(
      '*[_type == "userPost" && userId == $auth0Id]._id',
      { auth0Id }
    );

    if (posts.length > 0) {
      await sanityClient.delete({
        query: '*[_type == "userPost" && userId == $auth0Id]',
        params: { auth0Id },
      });
    }

    // 4. Opdater køb til at fjerne referencen til brugeren
    await sanityClient
      .patch({
        query: '*[_type == "purchase" && references($userId)]',
        params: { userId: sanityUserId },
      })
      .unset(["user"])
      .commit();

    // 5. Slet selve brugeren fra Sanity
    await sanityClient.delete(sanityUserId);

    console.log(
      "User and related data deleted successfully from both systems:",
      auth0Id
    );
    res.json({
      message: "User deleted successfully from both Auth0 and Sanity",
      status: "success",
    });
  } catch (error) {
    console.error("Error in delete user process:", error);
    res.status(500).json({
      message: "Failed to complete user deletion process",
      error: error.message,
    });
  }
};
