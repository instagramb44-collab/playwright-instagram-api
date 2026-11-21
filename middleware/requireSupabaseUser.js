const PLATFORM_SUPABASE_URL = process.env.PLATFORM_SUPABASE_URL;
const PLATFORM_SUPABASE_PUBLISHABLE_KEY = process.env.PLATFORM_SUPABASE_PUBLISHABLE_KEY;

async function requireSupabaseUser(req, res, next) {
  if (!PLATFORM_SUPABASE_URL || !PLATFORM_SUPABASE_PUBLISHABLE_KEY) {
    return res.status(503).json({ error: "Platform authentication service is not configured." });
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "A valid Platform Supabase access token is required." });
  }

  try {
    const response = await fetch(PLATFORM_SUPABASE_URL.replace(/\\/$/, "") + "/auth/v1/user", {
      headers: { apikey: PLATFORM_SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + match[1] },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return res.status(401).json({ error: "Invalid or expired access token." });
    const user = await response.json();
    if (!user || typeof user.id !== "string") {
      return res.status(401).json({ error: "Unable to verify authenticated user." });
    }
    req.user = { id: user.id, email: user.email || null };
    return next();
  } catch (error) {
    console.error("Platform Supabase token verification failed:", error.message);
    return res.status(503).json({ error: "Authentication service is temporarily unavailable." });
  }
}

module.exports = { requireSupabaseUser };
