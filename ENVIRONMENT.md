# ReelData backend environment

Copy these variable names into your hosting provider's **server-side** environment settings. Never put secret values in the frontend or commit a real `.env` file.

Required for Supabase-backed API authentication:
- `SUPABASE_URL`: ReelData Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key used only to verify user access tokens through Supabase Auth.
- `SUPABASE_SECRET_KEY`: server-only Supabase secret key used by the backend to access the private Instagram connection row.

Required before storing any Instagram browser session:
- `INSTAGRAM_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte random key. Generate with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Do not use the VitaAI Supabase project. Use the dedicated `reeldata-sessions` project.

## Current authenticated endpoints

- `GET /api/instagram/connection` — returns only the signed-in user's connection status.
- `DELETE /api/instagram/connection` — clears that user's saved session fields and sets status to disconnected.

Send the Supabase access token as `Authorization: Bearer <access_token>`.

The interactive remote-browser login flow is intentionally not implemented in this phase. No Instagram credentials, cookies, or browser state should be supplied by the frontend. A future browser worker must create the state server-side, encrypt it with AES-256-GCM, and persist only the encrypted fields.

The existing in-memory Reel job endpoints are unchanged and are not yet tenant-isolated or persistent. Do not expose them publicly for multi-user production use until that separate migration is completed.
