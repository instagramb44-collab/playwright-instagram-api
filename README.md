# ReelData API

Node.js + Express API with a Playwright worker.

## Backend environment variables

Configure these only in the backend host (for example, Render). The backend intentionally uses two Supabase projects:

| Variable | Project / purpose |
| --- | --- |
| `APP_SUPABASE_URL` | `reeldata-platform` URL; Auth verification and Creator Lookup History |
| `APP_SUPABASE_PUBLISHABLE_KEY` | Main project publishable key; sent as `apikey` when verifying user tokens |
| `APP_SUPABASE_SECRET_KEY` | Main project server-only secret key; Creator Lookup History database access |
| `SESSION_SUPABASE_URL` | `reeldata-sessions` URL; encrypted Instagram sessions only |
| `SESSION_SUPABASE_SECRET_KEY` | Sessions project server-only secret key |
| `INSTAGRAM_SESSION_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM encryption key |

Never expose either secret key or the encryption key in browser code or commit their values. Generate an encryption key with `openssl rand -base64 32`. Keep it stable across deployments.

## Authentication and data separation

Protected API endpoints require `Authorization: Bearer <Supabase access token>`. The backend validates that token against the **main application project** and uses only the verified user UUID.

- Creator Lookup History is stored in `reeldata-platform.public.creator_lookup_history`.
- Encrypted Instagram Playwright storage state is stored in `reeldata-sessions.public.instagram_connections`, keyed by `app_user_id`.
- The legacy sessions-project `user_id` field is retained for old rows. Existing legacy connections are not automatically mapped to platform accounts; a reconnect may be required after migration.
- The encryption key remains server-side. Session state is never sent to the frontend.

## Instagram connection API

- `GET /api/instagram/connection` — returns safe status metadata for the signed-in user.
- `DELETE /api/instagram/connection` — deletes only that user's stored Instagram connection.
- `POST /api/instagram/login/session` — starts a short-lived remote browser login session.
- `GET /api/instagram/login/session/:sessionId/frame` — returns a JPEG browser frame.
- `POST /api/instagram/login/session/:sessionId/input` — forwards supported browser input.
- `POST /api/instagram/login/session/:sessionId/complete` — checks for an Instagram session cookie and encrypts/stores Playwright state.

Users enter credentials on Instagram itself. This service does not bypass CAPTCHA, 2FA, or Instagram restrictions. Browser sessions are process-local and may be interrupted by a Render restart.

## Find Reel Creator and history

- `POST /api/instagram/reel/profile` — looks up one Reel creator using the signed-in user's saved Instagram session.
- `POST /api/jobs` — accepts up to 100 Reel URLs and returns individual lookup results.
- `GET /api/creator-lookups/history?limit=200` — reads persistent history for the signed-in user from the main project.

Instagram may rate-limit, challenge, or change page markup. The API returns safe errors instead of inventing creator details.

## Other operational limits

- Chromium capacity is process-wide; Render Free should generally remain at one active browser slot.
- Jobs and interactive browser sessions are in process memory and do not survive a server restart.
- The worker/provider remains a prototype placeholder; this does not claim support for every Instagram scraping field.
