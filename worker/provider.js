
async function getCreator(reelUrl) {
  // Placeholder until an authorized creator-data API is configured.
  // Do not scrape Instagram pages or bypass access restrictions.

  if (!reelUrl) {
    throw new Error("Reel URL is required.");
  }

  throw new Error(
    "Creator data provider is not configured yet."
  );
}

module.exports = { getCreator };
