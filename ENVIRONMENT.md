# ReelData backend environment

Node.js 20 or newer is required.

Set these variables in the backend host's server-side environment settings. Never put secret values in the frontend or commit a real `.env` file.

Platform authentication:
- `PLATFORM_SUPABASE_URL`: the ReelData Platform Supabase project URL.
- `PLATFORM_SUPABASE_PUBLISHABLE_KEY`: Platform Supabase publishable key used to validate bearer tokens with Auth.

Instagram session storage:
- `SESSIONS_SUPABASE_URL`: the separate Sessions Supabase project URL.
- `SESSIONS_SUPABASE_SECRET_KEY`: server-only Sessions Supabase secret key used to access encrypted Instagram connection rows.
- `INSTAGRAM_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte random key used for AES-256-GCM encryption. Generate with `openssl rand -base64 32`.

Do not set the Sessions Supabase project as the authentication project. The frontend and API authenticate users only through Platform Supabase. The backend alone accesses Sessions Supabase. Never expose either server-only secret key or the encryption key to browser code.

## Ownership model

The API validates each bearer token against Platform Supabase Auth and obtains the user UUID from the verified response. All new Instagram session rows are queried and written by `app_user_id` using that Platform user UUID. The legacy Sessions Auth `user_id` column is not used as a fallback because it belongs to a different identity namespace. Existing legacy rows must be explicitly migrated and ownership-verified before they can be reused.

## Authenticated API

Send `Authorization: Bearer <Platform Supabase access token>`.

- `GET /api/instagram/connection` — returns the signed-in user's safe connection status.
- `DELETE /api/instagram/connection` — deletes only that user's encrypted Instagram session row.
- `POST /api/jobs` — creates an in-memory Reel import job.
- `GET /api/jobs/:jobId` and `GET /api/jobs/:jobId/results` — only the job owner can read it.

Job records remain in process memory and are not yet suitable for multi-instance production deployment.

## Instagram session safety

Playwright storage state is encrypted by the backend before storage and decrypted only by the backend. It is never returned to the client. Users enter Instagram credentials directly in Instagram; do not ask users to send passwords, cookies, or session files. Do not bypass CAPTCHA, login challenges, rate limits, or platform restrictions.

## Verify locally

Run `npm test` to test the backend, including the Platform-user-to-Sessions-row ownership rules. Run `npm start` to start the API.
