const { getSupabaseConfig, getSupabaseUser } = require("../lib/supabase");

async function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "A valid Supabase access token is required." });
  }

  try {
    const config = getSupabaseConfig();
    if (!config) {
      return res.status(503).json({ error: "Authentication service is not configured." });
    }

    // Ask Supabase Auth to validate the token. Do not trust decoded JWT claims.
    const user = await getSupabaseUser(config, match[1]);
    if (!user?.id) {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }

    req.user = { id: user.id, email: user.email || null };
    next();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }
    console.error("Authentication verification failed:", error.message);
    return res.status(502).json({ error: "Could not verify the access token." });
  }
}

module.exports = { requireAuth };
