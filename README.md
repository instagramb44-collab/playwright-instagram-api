# ReelData API

Node.js + Express API with a Playwright worker.

## Two Supabase projects

ReelData deliberately uses two separate Supabase projects with different responsibilities.

### Platform Supabase
- Owns SaaS user accounts and authentication.
- Owns profiles, jobs, usage, subscriptions, results, and future Competitor Analysis history.
- The frontend signs in here and sends its access token to this API.
- The backend verifies the token against Platform Supabase Auth and derives the user UUID from the verified token.

### Sessions Supabase
- Stores encrypted Instagram browser sessions only.
- The backend accesses it with a server-only secret key.
- New SaaS session rows are owned by `app_user_id`, containing the verified Platform Supabase Auth UUID.
- The legacy `user_id` column belongs to the old Sessions Auth identity namespace. It is not a fallback for Platform users.
- Instagram session ciphertext is never returned to the frontend.

## Backend environment variables

Configure these only in the backend host (for example, Render). Never expose server-only keys in browser code or commit real values.

Platform authentication:
- `PLATFORM_SUPABASE_URL`: Platform Supabase project URL.
- `PLATFORM_SUPABASE_PUBLISHABLE_KEY`: Platform publishable key used to verify bearer tokens with `/auth/v1/user`.

Encrypted Instagram session storage:
- `SESSIONS_SUPABASE_URL`: Sessions Supabase project URL.
- `SESSIONS_SUPABASE_SECRET_KEY`: server-only Sessions Supabase secret key used for database operations. It bypasses RLS; never expose it in browser code.
- `INSTAGRAM_SESSION_ENCRYPTION_KEY`: base64-encoded 32-byte key used for AES-256-GCM encryption of Playwright storage state.

Optional:
- `MAX_ACTIVE_BROWSER_INSTANCES`: shared process-wide Chromium capacity. Defaults to 1; accepted values are 1–4.

Generate an encryption key with:
```bash
openssl rand -base64 32
```

Never commit real environment values, cookies, browser profiles, or Playwright storage-state files.

## Authentication

Protected API endpoints require:
```http
Authorization: Bearer <Platform Supabase access token>
```

The backend validates the token with Platform Supabase Auth's `/auth/v1/user` endpoint. It never trusts a user ID from request parameters or request bodies. The verified Platform user UUID is used as `app_user_id` in Sessions Supabase.

## Instagram connection API
- `GET /api/instagram/connection` — returns safe status metadata for the signed-in Platform user.
- `DELETE /api/instagram/connection` — deletes only that user's stored Instagram connection.

Session state is encrypted using AES-256-GCM before storage. The encryption key is held in the backend environment, not in Supabase or the frontend. The session store is server-only.

### Embedded Instagram login

The backend exposes a short-lived, authenticated Playwright browser session. The frontend can poll JPEG screenshots and forward click, type, key, and scroll input so users can complete Instagram login themselves.

- `POST /api/instagram/login/session` — starts a 10-minute browser session.
- `GET /api/instagram/login/session/:sessionId/frame` — returns the current JPEG browser frame.
- `POST /api/instagram/login/session/:sessionId/input` — forwards a supported browser input action (`click`, `type`, `press`, or `scroll`).
- `POST /api/instagram/login/session/:sessionId/complete` — checks for an Instagram `sessionid` cookie and encrypts/stores Playwright state.
- `DELETE /api/instagram/login/session/:sessionId` — closes the caller's own browser session.

All endpoints require a Platform Supabase access token. Browser sessions are held in API-process memory and isolated by verified Platform user UUID. Typed input is never logged. Top-level navigation is restricted to Instagram domains.

**Security and operational limits:** ReelData does not store Instagram passwords in plaintext, bypass CAPTCHA/2FA, or evade Instagram restrictions. Users enter credentials on Instagram itself. Browser login sessions are process-local and expire after 10 minutes.

## Reel creator lookup
- `POST /api/instagram/reel/profile` — looks up the creator for one Reel URL.
- Requires a valid Platform Supabase bearer token and the signed-in user's connected Instagram account.
- Request body: `{ "url": "https://www.instagram.com/reel/SHORTCODE/" }`.
- The backend loads only that authenticated Platform user's encrypted saved session.
- Instagram rate limits, challenges, and markup changes are returned as safe errors; no creator details are invented.

This endpoint performs one Reel lookup per request. It does not yet provide likes, comments, views, or batch scraping.

### Live Reel creator lookup
- `POST /api/instagram/reel/lookup/session` — authenticated; accepts a Reel URL and returns a short-lived viewer token.
- `wss://<api-host>/ws/instagram/reel/lookup/:sessionId` — authenticate the first message with the single-use viewer token.
- `DELETE /api/instagram/reel/lookup/session/:sessionId` — authenticated, owner-only cleanup.
- Browser capacity is shared across login and Reel lookup; a full slot returns HTTP 429.

## Reel jobs
- `POST /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/results`

These endpoints require Platform Supabase authentication and enforce per-user access to in-memory jobs. Jobs are not yet persistent across server restarts.
