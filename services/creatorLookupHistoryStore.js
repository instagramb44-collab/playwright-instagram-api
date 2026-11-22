const PLATFORM_SUPABASE_URL = process.env.PLATFORM_SUPABASE_URL;
const PLATFORM_SUPABASE_SECRET_KEY = process.env.PLATFORM_SUPABASE_SECRET_KEY;

function getConfig() {
  if (!PLATFORM_SUPABASE_URL || !PLATFORM_SUPABASE_SECRET_KEY) {
    const error = new Error("Platform Supabase server secret is not configured.");
    error.status = 503;
    throw error;
  }
  return {
    url: PLATFORM_SUPABASE_URL.replace(/\/$/, ""),
    key: PLATFORM_SUPABASE_SECRET_KEY
  };
}

async function platformRequest(path, options = {}) {
  const config = getConfig();
  const response = await fetch(config.url + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: "Bearer " + config.key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[Creator Lookup History] Platform database request failed", {
      status: response.status,
      detail: detail.slice(0, 300)
    });
    const error = new Error("Unable to save or load creator lookup history.");
    error.status = 502;
    throw error;
  }

  // PostgREST may return 201 with an empty body for Prefer: return=minimal.
  // Treat any successful empty response like 204 instead of parsing it as JSON.
  const body = await response.text();
  if (!body.trim()) return [];
  return JSON.parse(body);
}

async function saveCreatorLookupHistory(userId, results, batchId) {
  if (!userId) throw new Error("Verified Platform user ID is required.");
  if (!Array.isArray(results) || results.length === 0) return;
  const rows = results.map((result) => ({
    user_id: userId,
    batch_id: batchId,
    reel_url: String(result.reelUrl || "").slice(0, 2048),
    shortcode: result.shortcode || null,
    creator_username: result.username || null,
    profile_name: result.profileName || null,
    profile_url: result.profileUrl || null,
    error: result.error || null
  }));
  await platformRequest("creator_lookup_history", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function fetchCreatorLookupHistory(userId, limit = 200) {
  if (!userId) throw new Error("Verified Platform user ID is required.");
  const safeLimit = Number.isInteger(limit) ? Math.min(200, Math.max(1, limit)) : 200;
  const query = new URLSearchParams({
    select: "id,batch_id,reel_url,creator_username,profile_name,profile_url,error,created_at",
    user_id: "eq." + userId,
    order: "created_at.desc",
    limit: String(safeLimit)
  });
  return platformRequest("creator_lookup_history?" + query.toString(), {
    method: "GET"
  });
}

module.exports = { saveCreatorLookupHistory, fetchCreatorLookupHistory };
