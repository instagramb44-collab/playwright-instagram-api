# ReelData API

Node.js + Express API with a Playwright worker.

## Backend environment variables

Configure these only in the backend host (for example, Render):

- `SUPABASE_URL`: ReelData Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key used when validating a user's bearer token with Supabase Auth.
- `SUPABASE_SECRET_KEY`: Supabase secret key used only by this backend for database operations. It bypasses RLS; never expose it in browser code or commit its value.
- `INSTAGRAM_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte key used for AES-256-GCM encryption of Playwright storage state.

Generate an encryption key with:

```bash
openssl rand -base64 32
```

Never commit real environment values, cookies, browser profiles, or Playwright storage-state files.

## Authentication

Protected API endpoints require:

```http
Authorization: Bearer <Supabase access token>
```

The backend validates the token with Supabase Auth's `/auth/v1/user` endpoint. It never trusts a user ID from request parameters or request bodies.

## Instagram connection API

- `GET /api/instagram/connection` — returns only safe status metadata for the signed-in user.
- `DELETE /api/instagram/connection` — deletes only that user's stored Instagram connection.

Session state is encrypted using AES-256-GCM before storage. The encryption key is held in the backend environment, not in Supabase or the frontend. The session store is server-only and uses the authenticated Supabase user ID as the owner key.

**Important:** Interactive Instagram login/browser streaming is not implemented yet. The connection status remains disconnected until a trusted browser-session flow is added and a session is explicitly saved. Do not ask users to send Instagram passwords, cookies, or session files.

## Reel jobs

- `POST /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/results`

These endpoints now require Supabase authentication and enforce per-user access to in-memory jobs. Jobs are still in-memory and will not survive a server restart; persistent job storage is a later step.

The Playwright worker/provider is still a smoke test/placeholder. No Instagram scraping is started by this change.
