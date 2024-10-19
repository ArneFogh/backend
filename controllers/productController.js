const { sanityClient } = require('../sanityClient');

exports.getAllProducts = async (req, res) => {
  try {
    const query = `*[_type == "product"]{
      _id,
      name,
      price,
      "imageUrl": featuredImage.asset->url
    }`;
    const products = await sanityClient.fetch(query);
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const query = `*[_type == "product" && _id == $id][0]{
      _id,
      name,
      price,
      description,
      "images": [featuredImage.asset->url, ...images[].asset->url],
      "category": category->name,
      specifications
    }`;
    const product = await sanityClient.fetch(query, { id });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
};