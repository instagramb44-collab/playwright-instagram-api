const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function requireSupabaseUser(req, res, next) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(503).json({ error: "Authentication service is not configured." });
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "A valid Supabase access token is required." });
  }

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${match[1]}`
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }

    const user = await response.json();
    if (!user || typeof user.id !== "string") {
      return res.status(401).json({ error: "Unable to verify authenticated user." });
    }

    req.user = { id: user.id, email: user.email || null };
    return next();
  } catch (error) {
    console.error("Supabase token verification failed:", error.message);
    return res.status(503).json({ error: "Authentication service is temporarily unavailable." });
  }
}

module.exports = { requireSupabaseUser };
