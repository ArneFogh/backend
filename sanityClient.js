const { createClient } = require('@sanity/client');
const imageUrlBuilder = require('@sanity/image-url');

const sanityClient = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-06-24',
  useCdn: false,
  token: process.env.SANITY_SECRET_TOKEN,
});

const builder = imageUrlBuilder(sanityClient);

function urlFor(source) {
  return builder.image(source);
}

module.exports = { sanityClient, urlFor };