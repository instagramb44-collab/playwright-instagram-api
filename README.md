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

### Embedded Instagram login (prototype API)

The backend exposes a short-lived, authenticated Playwright browser session. The frontend can poll JPEG screenshots and forward click, type, key, and scroll input so users can complete Instagram login themselves.

- `POST /api/instagram/login/session` — starts a 10-minute browser session; returns `sessionId`.
- `GET /api/instagram/login/session/:sessionId/frame` — returns the current JPEG browser frame.
- `POST /api/instagram/login/session/:sessionId/input` — forwards one supported browser input action (`click`, `type`, `press`, or `scroll`).
- `POST /api/instagram/login/session/:sessionId/complete` — checks for an Instagram `sessionid` cookie and, if present, encrypts and stores Playwright storage state.
- `DELETE /api/instagram/login/session/:sessionId` — closes the caller's own browser session.
- `DELETE /api/instagram/connection` — closes the caller's active browser session and removes the saved connection.

All endpoints require the caller's Supabase access token. Browser sessions are held in API-process memory and are isolated by Supabase user ID. The browser is headless on the server; the UI must render returned frames and send input actions. The session expires after 10 minutes. Typed input is never logged. Only two interactive browser sessions can run concurrently on this API instance, and top-level browser navigation is restricted to Instagram domains.

**Security and operational limits:** This prototype does not collect Instagram passwords into ReelData storage, bypass CAPTCHA/2FA, or evade Instagram restrictions. Users enter credentials on Instagram itself. The session is in-memory, so a server restart or instance replacement interrupts login. Do not scale the API to multiple instances until browser sessions are moved to shared session infrastructure. The frontend browser panel is not included in this backend change. Instagram may change its login UI or block automated browsing; connection completion only confirms the presence of a session cookie, not that every Instagram feature will be accessible.

## Reel jobs

- `POST /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/results`

These endpoints now require Supabase authentication and enforce per-user access to in-memory jobs. Jobs are still in-memory and will not survive a server restart; persistent job storage is a later step.

The Playwright worker/provider is still a smoke test/placeholder. No Instagram scraping is started by this change.
