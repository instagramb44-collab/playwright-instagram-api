function safeAuthErrorDetails(payload) {
  if (!payload || typeof payload !== "object") return {};
  const code = payload.code || payload.error || payload.error_code;
  const message = payload.msg || payload.message || payload.error_description;
  return {
    ...(typeof code === "string" ? { code: code.slice(0, 80) } : {}),
    ...(typeof message === "string" ? { message: message.replace(/[\r\n\t]+/g, " ").slice(0, 160) } : {})
  };
}

async function requireSupabaseUser(req, res, next) {
  const supabaseUrl = process.env.APP_SUPABASE_URL;
  const publishableKey = process.env.APP_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    console.error("[Auth] Application Supabase configuration is missing.", {
      hasAppSupabaseUrl: Boolean(supabaseUrl),
      hasAppSupabasePublishableKey: Boolean(publishableKey)
    });
    return res.status(503).json({ error: "Application authentication service is not configured." });
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "A valid Supabase access token is required." });
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${match[1]}`
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      let details = {};
      try {
        details = safeAuthErrorDetails(await response.json());
      } catch {
        // Supabase may return an empty or non-JSON error response.
      }

      console.warn("[Auth] Supabase rejected access-token verification.", {
        status: response.status,
        ...details
      });

      if (response.status >= 500 || response.status === 429) {
        return res.status(503).json({ error: "Authentication service is temporarily unavailable." });
      }
      return res.status(401).json({ error: "Invalid or expired access token." });
    }

    const user = await response.json();
    if (!user || typeof user.id !== "string") {
      console.warn("[Auth] Supabase user verification returned an invalid user payload.");
      return res.status(401).json({ error: "Unable to verify authenticated user." });
    }

    req.user = { id: user.id, email: user.email || null };
    return next();
  } catch (error) {
    console.error("[Auth] Supabase token verification request failed.", {
      errorName: error?.name || "Error"
    });
    return res.status(503).json({ error: "Authentication service is temporarily unavailable." });
  }
}

module.exports = { requireSupabaseUser };
