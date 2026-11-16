# ReelData backend environment

Node.js 20 or newer is required. Configure all variables below only in Render's server-side environment settings. Never commit real values or put secret keys in Vercel/browser code.

## Required Render variables

### Main application project — `reeldata-platform`
- `APP_SUPABASE_URL` — `https://idsvtzsravxgxpotkfzc.supabase.co`
- `APP_SUPABASE_PUBLISHABLE_KEY` — publishable key used with the user's Bearer access token to verify the signed-in account.
- `APP_SUPABASE_SECRET_KEY` — server-only secret key used to save/read `public.creator_lookup_history`.

### Instagram session project — `reeldata-sessions`
- `SESSION_SUPABASE_URL` — `https://ssrzmdtdrmevydfioxba.supabase.co`
- `SESSION_SUPABASE_SECRET_KEY` — server-only secret key used only for encrypted `public.instagram_connections` rows.

### Encryption
- `INSTAGRAM_SESSION_ENCRYPTION_KEY` — base64-encoded 32-byte random key. Generate once and keep the same value across deploys:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Do not use the session project's key for application data. Do not send either secret key or the encryption key to Vercel. The Vercel frontend should use only the main application's URL and publishable key.

## Identity and data ownership

The backend verifies the access token against `APP_SUPABASE_URL`. The verified platform Auth user UUID is used for Creator Lookup History and stored in `instagram_connections.app_user_id` in the separate sessions project.

The legacy `instagram_connections.user_id` column and its sessions-project Auth foreign key are retained for existing rows. Existing legacy connections are not automatically mapped to platform users; users with only a legacy row may need to reconnect Instagram after this backend version is deployed. No encrypted session data is deleted by the schema migration.

## Authenticated API

Send the platform Supabase access token as `Authorization: Bearer <access_token>`.

- `GET /api/creator-lookups/history` — reads the signed-in user's Creator Lookup History from the platform project.
- `GET /api/instagram/connection` — returns the signed-in user's connection status.
- `DELETE /api/instagram/connection` — deletes that user's encrypted session row.
- `POST /api/jobs` — performs Creator Lookup and persists results to the platform project.

The backend never trusts a user ID from request parameters or request bodies.

## Instagram session safety

Playwright storage state is encrypted using AES-256-GCM before it is stored in the sessions project. Browser state is never returned to the client. Do not ask users to send Instagram passwords, cookies, or session files. Do not bypass CAPTCHA, login challenges, rate limits, or platform restrictions.

## Verify locally

Run `npm test` and `npm start`. Confirm Render has all six variables above before deploying this branch.
