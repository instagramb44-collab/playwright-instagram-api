function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) return null;

  return {
    url: url.replace(/\/$/, ""),
    secretKey
  };
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });

  const body = await response.text();
  let data = null;

  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "object" && data?.message
        ? data.message
        : "Supabase request failed."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getSupabaseUser(config, accessToken) {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const error = new Error("Supabase rejected the access token.");
    error.status = response.status;
    throw error;
  }

  return response.json();
}

module.exports = {
  getSupabaseConfig,
  getSupabaseUser,
  supabaseRequest
};
