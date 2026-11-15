# ReelData backend environment

Node.js 20 or newer is required.

Set these variables in the backend host's **server-side environment settings**. Never put secret values in the frontend or commit a real `.env` file.

Required:
- `SUPABASE_URL`: ReelData Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key used to verify user access tokens with Supabase Auth.
- `SUPABASE_SECRET_KEY`: server-only secret key used by the backend to access the private Instagram connection row.
- `INSTAGRAM_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte random key. Generate with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Use the dedicated `reeldata-sessions` Supabase project, not the VitaAI project. Keep all keys on the backend host. Do not send the secret key or encryption key to Vercel/browser code.

## Authenticated API

Send a Supabase access token as `Authorization: Bearer <access_token>`.

- `GET /api/instagram/connection` — returns the signed-in user's connection status and timestamps only.
- `DELETE /api/instagram/connection` — deletes that user's encrypted Instagram session row.
- `POST /api/jobs` — creates an in-memory Reel import job for the signed-in user.
- `GET /api/jobs/:jobId` and `GET /api/jobs/:jobId/results` — only the job owner can read it.

The API verifies access tokens against Supabase Auth before using the user UUID. Job records remain in process memory, so they are lost on restart and are not yet suitable for multi-instance production deployment.

## Instagram session safety

AES-256-GCM encryption/decryption helpers and a per-user Supabase storage service are in place. Browser state is never returned to the client. The interactive remote-browser login flow is intentionally not implemented yet. A future worker must create Playwright storage state server-side, then call the storage service to encrypt and persist it.

Do not ask users to send Instagram passwords, cookies, or session files. Do not bypass CAPTCHA, login challenges, rate limits, or platform restrictions.

## Verify locally

Run `npm test` to test AES-GCM round-trip, unique IV generation, and tamper detection. Run `npm start` to start the API.
