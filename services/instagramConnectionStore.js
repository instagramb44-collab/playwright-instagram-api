const { encryptStorageState, decryptStorageState } = require("../lib/instagramSessionVault");

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase backend configuration is missing.");
  return { url: url.replace(/\/$/, ""), key };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Instagram connection storage error:", response.status, detail);
    throw new Error("Instagram connection storage operation failed.");
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getConnectionStatus(userId) {
  const rows = await request(
    `instagram_connections?select=status,connected_at,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );
  return rows[0] || null;
}

async function saveStorageState(userId, storageState) {
  if (!userId || !storageState || typeof storageState !== "object") {
    throw new Error("A user ID and Playwright storage state are required.");
  }

  const encrypted = encryptStorageState(storageState);
  const existing = await request(
    `instagram_connections?select=id&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );

  const payload = {
    user_id: userId,
    status: "connected",
    ...encrypted,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error_code: null
  };

  if (existing.length) {
    await request(`instagram_connections?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });
  } else {
    await request("instagram_connections", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });
  }
}

async function loadStorageState(userId) {
  const rows = await request(
    `instagram_connections?select=encrypted_storage_state,encryption_iv,encryption_auth_tag,status&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );
  const record = rows[0];
  if (!record || record.status !== "connected" || !record.encrypted_storage_state) return null;
  return decryptStorageState(record);
}

async function disconnect(userId) {
  await request(
    `instagram_connections?user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
}

module.exports = { getConnectionStatus, saveStorageState, loadStorageState, disconnect };
