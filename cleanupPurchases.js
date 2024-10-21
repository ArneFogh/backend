const { createClient } = require("@sanity/client");

const client = createClient({
  projectId: "2qy4me6i",
  dataset: "production",
  apiVersion: "2024-06-24",
  useCdn: false,
  token:
    "skjt1wup70ep81UC7VJQBmjrw9aFueRByPKzGSmRix7vdA1SelFQTdqaTVjqRyEp3tzk9OpGZXcdIn6wDhiLuWVUkbcbKnmNhEvTDEG4upyL3FzHWwg9JKdihZF7O6mdiRFqwCrh8FZ3wldxAZcWFcVyVCB830LNyqffTWwQd9HYBta88RJF",
});

async function deletePurchasesAndRemoveReferences() {
  try {
    // Fetch all purchase document IDs
    const purchaseIds = await client.fetch(`*[_type == "purchase"]._id`);

    console.log(`Found ${purchaseIds.length} purchase documents.`);

    if (purchaseIds.length === 0) {
      console.log("No purchase documents found.");
      return;
    }

    // Fetch all user documents that have the 'purchases' field defined
    const usersWithPurchases = await client.fetch(
      `*[_type == "user" && defined(purchases)]{_id}`
    );

    console.log(
      `Found ${usersWithPurchases.length} user documents with purchases field.`
    );

    // Create an array of patch mutations to remove 'purchases' field from users
    const patches = usersWithPurchases.map((user) =>
      client.patch(user._id).unset(["purchases"])
    );

    // Commit patches in batches
    while (patches.length > 0) {
      const batch = patches.splice(0, 50); // Adjust batch size as needed
      const transaction = client.transaction();
      batch.forEach((patch) => transaction.patch(patch));
      await transaction.commit();
      console.log(
        `Updated a batch of user documents to remove 'purchases' field.`
      );
    }

    console.log(`Removed 'purchases' field from all user documents.`);

    // Delete purchase documents in batches
    while (purchaseIds.length > 0) {
      const batchIds = purchaseIds.splice(0, 50); // Adjust batch size as needed
      const transaction = client.transaction();
      batchIds.forEach((id) => transaction.delete(id));
      await transaction.commit();
      console.log(`Deleted a batch of purchase documents.`);
    }

    console.log(`Deleted all purchase documents.`);
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

deletePurchasesAndRemoveReferences();
