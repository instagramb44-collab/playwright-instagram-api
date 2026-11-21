const { encryptStorageState, decryptStorageState } = require("../lib/instagramSessionVault");

function config() {
  const url = process.env.SESSIONS_SUPABASE_URL;
  const key = process.env.SESSIONS_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Sessions Supabase backend configuration is missing.");
  return { url: url.replace(/\\/$/, ""), key };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(url + "/rest/v1/" + path, {
    ...options,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Instagram connection storage error:", response.status, detail);
    throw new Error("Instagram connection storage operation failed.");
  }
  if (response.status === 204) return null;
  return response.json();
}

// Platform Auth UUID is the only owner key for SaaS rows. Never fall back to legacy Sessions Auth user_id.
function ownedRowsPath(select, userId) {
  if (!userId || typeof userId !== "string") throw new Error("A verified Platform user ID is required.");
  return "instagram_connections?select=" + select + "&app_user_id=eq." + encodeURIComponent(userId) + "&limit=1";
}

async function getConnectionStatus(userId) {
  const rows = await request(ownedRowsPath("status,connected_at,updated_at", userId));
  return rows[0] || null;
}

async function saveStorageState(userId, storageState) {
  if (!userId || typeof userId !== "string" || !storageState || typeof storageState !== "object") {
    throw new Error("A verified Platform user ID and Playwright storage state are required.");
  }
  const encrypted = encryptStorageState(storageState);
  const existing = await request(ownedRowsPath("id", userId));
  const now = new Date().toISOString();
  const payload = { user_id: null, app_user_id: userId, status: "connected", ...encrypted, connected_at: now, updated_at: now, last_error_code: null };
  if (existing.length) {
    await request("instagram_connections?app_user_id=eq." + encodeURIComponent(userId), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload)
    });
  } else {
    await request("instagram_connections", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
  }
}

async function loadStorageState(userId) {
  const rows = await request(ownedRowsPath("encrypted_storage_state,encryption_iv,encryption_auth_tag,status", userId));
  const record = rows[0];
  if (!record || record.status !== "connected" || !record.encrypted_storage_state) return null;
  return decryptStorageState(record);
}

async function disconnect(userId) {
  if (!userId || typeof userId !== "string") throw new Error("A verified Platform user ID is required.");
  await request("instagram_connections?app_user_id=eq." + encodeURIComponent(userId), { method: "DELETE" });
}

module.exports = { getConnectionStatus, saveStorageState, loadStorageState, disconnect };
