function config() {
  const url = process.env.APP_SUPABASE_URL;
  const key = process.env.APP_SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Application Supabase backend configuration is missing.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Creator lookup history storage error:", response.status, detail);
    throw new Error("Unable to save or load Creator Lookup history.");
  }
  // PostgREST may return an empty body for a successful minimal-return insert.
  // The history row can already be committed even when there is no JSON to parse.
  if (response.status === 204) return null;

  const responseBody = await response.text();
  if (!responseBody.trim()) return null;

  try {
    return JSON.parse(responseBody);
  } catch {
    console.error("Creator lookup history storage returned invalid JSON.");
    throw new Error("Creator lookup history storage returned an invalid response.");
  }
}

async function saveCreatorLookupHistory(userId, batchId, results) {
  if (!userId || !batchId || !Array.isArray(results) || results.length === 0) return;

  const rows = results.map((item) => ({
    user_id: userId,
    batch_id: batchId,
    reel_url: item.reelUrl,
    shortcode: item.shortcode || null,
    creator_username: item.username || null,
    profile_name: item.profileName || null,
    profile_url: item.profileUrl || null,
    error: item.error || null
  }));

  await request("creator_lookup_history", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function getCreatorLookupHistory(userId, limit = 100) {
  if (!userId) throw new Error("A verified user ID is required to load Creator Lookup history.");
  const params = new URLSearchParams({
    select: "id,batch_id,reel_url,shortcode,creator_username,profile_name,profile_url,error,created_at",
    user_id: `eq.${userId}`,
    order: "created_at.desc",
    limit: String(Math.max(1, Math.min(Number(limit) || 100, 200)))
  });
  return request(`creator_lookup_history?${params.toString()}`);
}

module.exports = { saveCreatorLookupHistory, getCreatorLookupHistory };
