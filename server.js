const express = require("express");
const http = require("node:http");
const { randomUUID } = require("crypto");
const { requireSupabaseUser } = require("./middleware/requireSupabaseUser");
const { getConnectionStatus, disconnect } = require("./services/instagramConnectionStore");
const { lookupReelCreator } = require("./services/instagramReelLookup");
const { loadStorageState } = require("./services/instagramConnectionStore");
const { saveCreatorLookupHistory, fetchCreatorLookupHistory } = require("./services/creatorLookupHistoryStore");
const { createLookupSession, getOwnedSession, closeLookupSession, attachReelLookupWebSocket } = require("./services/instagramReelLookupSession");
const {
  startLoginSession,
  getFrame,
  sendInput,
  completeLoginSession,
  closeUserSessions,
  closeOwnedSession
} = require("./services/instagramBrowserSession");

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = new Set([
  "https://reeldata-platform65.vercel.app",
  "https://reeldata-platform-9ug5.vercel.app",
  "https://reeldata-platform6544.vercel.app",
  "http://localhost:5173"
]);

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }

  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json({ limit: "1mb" }));

const jobs = new Map();

function validateReelUrl(input) {
  try {
    const url = new URL(input.trim());

    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }

    const match = url.pathname.match(/^\/(?:reel|reels)\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) return null;

    return {
      normalizedUrl: `https://www.instagram.com/reel/${match[1]}/`,
      shortcode: match[1]
    };
  } catch {
    return null;
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "online", service: "ReelData API" });
});

// Instagram connection status is scoped to the verified Supabase user.
app.get("/api/instagram/connection", requireSupabaseUser, async (req, res, next) => {
  try {
    const connection = await getConnectionStatus(req.user.id);
    res.json({
      status: connection?.status || "disconnected",
      connectedAt: connection?.connected_at || null,
      updatedAt: connection?.updated_at || null
    });
  } catch (error) {
    next(error);
  }
});

// Start a short-lived, user-owned remote browser for manual Instagram login.
app.post("/api/instagram/login/session", requireSupabaseUser, async (req, res, next) => {
  try {
    const session = await startLoginSession(req.user.id);
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

app.get("/api/instagram/login/session/:sessionId/frame", requireSupabaseUser, async (req, res, next) => {
  try {
    const frame = await getFrame(req.params.sessionId, req.user.id);
    if (!frame) return res.status(404).json({ error: "Browser session expired or not found." });
    res.setHeader("Cache-Control", "no-store");
    res.type("jpeg").send(frame);
  } catch (error) {
    next(error);
  }
});

app.post("/api/instagram/login/session/:sessionId/input", requireSupabaseUser, async (req, res, next) => {
  try {
    const accepted = await sendInput(req.params.sessionId, req.user.id, req.body || {});
    if (!accepted) return res.status(404).json({ error: "Browser session expired or not found." });
    res.setHeader("Cache-Control", "no-store");
    res.json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/instagram/login/session/:sessionId/complete", requireSupabaseUser, async (req, res, next) => {
  try {
    const connected = await completeLoginSession(req.params.sessionId, req.user.id);
    if (!connected) {
      return res.status(409).json({ error: "Instagram login is not complete yet. Finish logging in inside the browser." });
    }
    res.json({ status: "connected" });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/instagram/login/session/:sessionId", requireSupabaseUser, async (req, res, next) => {
  try {
    const closed = await closeOwnedSession(req.params.sessionId, req.user.id);
    if (!closed) return res.status(404).json({ error: "Browser session expired or not found." });
    res.json({ status: "closed" });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/instagram/connection", requireSupabaseUser, async (req, res, next) => {
  try {
    await closeUserSessions(req.user.id);
    await disconnect(req.user.id);
    res.json({ status: "disconnected" });
  } catch (error) {
    next(error);
  }
});

// Start a short-lived live browser session for a Reel creator lookup.
app.post("/api/instagram/reel/lookup/session", requireSupabaseUser, async (req, res, next) => {
  try {
    const input = req.body?.url;
    const parsed = typeof input === "string" ? validateReelUrl(input) : null;
    if (!parsed) return res.status(400).json({ error: "Please provide a valid Instagram Reel URL.", code: "INVALID_REEL_URL" });
    const storageState = await loadStorageState(req.user.id);
    if (!storageState) return res.status(409).json({ error: "Connect your Instagram account before looking up Reel creators.", code: "INSTAGRAM_NOT_CONNECTED" });
    const session = createLookupSession(req.user.id, parsed.normalizedUrl, parsed.shortcode);
    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json(session);
  } catch (error) { return next(error); }
});

app.delete("/api/instagram/reel/lookup/session/:sessionId", requireSupabaseUser, async (req, res, next) => {
  try {
    const session = getOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(204).end();
    await closeLookupSession(session.sessionId);
    return res.status(204).end();
  } catch (error) { return next(error); }
});
// Look up the creator of one Reel using the signed-in user's saved Instagram session.
app.post("/api/instagram/reel/profile", requireSupabaseUser, async (req, res, next) => {
  try {
    const input = req.body?.url;
    const parsed = typeof input === "string" ? validateReelUrl(input) : null;
    if (!parsed) {
      return res.status(400).json({
        error: "Please provide a valid Instagram Reel URL.",
        code: "INVALID_REEL_URL"
      });
    }

    const creator = await lookupReelCreator(req.user.id, parsed.normalizedUrl);
    return res.json({
      reelUrl: parsed.normalizedUrl,
      shortcode: parsed.shortcode,
      creator
    });
  } catch (error) {
    return next(error);
  }
});

// History is server-only and scoped to the verified Platform Supabase user.
app.get("/api/creator-lookups/history", requireSupabaseUser, async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 200)
      : 200;
    const items = await fetchCreatorLookupHistory(req.user.id, limit);
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

// Find Creator runs each lookup synchronously and returns final results only.
// Lookups are sequential because the Render service has one shared Chromium slot.
app.post("/api/jobs", requireSupabaseUser, async (req, res) => {
  const { urls } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Please provide an array of Reel URLs." });
  }
  if (urls.length > 100) {
    return res.status(400).json({ error: "Maximum 100 Reel URLs allowed per batch." });
  }

  const results = [];
  for (const input of urls) {
    const id = randomUUID();
    const parsed = typeof input === "string" ? validateReelUrl(input) : null;
    const reelUrl = parsed ? parsed.normalizedUrl : String(input);

    if (!parsed) {
      results.push({
        id,
        reelUrl,
        creator: null,
        username: null,
        profileName: null,
        profileUrl: null,
        error: "Unable to find creator. Please try again."
      });
      continue;
    }

    try {
      const creator = await lookupReelCreator(req.user.id, parsed.normalizedUrl);
      const safeCreator = {
        username: creator.username,
        profileName: creator.profileName || null,
        profileUrl: creator.profileUrl || `https://www.instagram.com/${creator.username}/`
      };
      results.push({
        id,
        reelUrl,
        creator: safeCreator,
        ...safeCreator
      });
    } catch (error) {
      console.warn("[Find Creator] lookup failed", {
        userId: req.user.id,
        shortcode: parsed.shortcode,
        status: Number.isInteger(error.status) ? error.status : 502,
        code: error.code || "CREATOR_LOOKUP_FAILED"
      });
      results.push({
        id,
        reelUrl,
        creator: null,
        username: null,
        profileName: null,
        profileUrl: null,
        error: "Unable to find creator. Please try again."
      });
    }
  }

  const batchId = randomUUID();
  await saveCreatorLookupHistory(req.user.id, results, batchId);

  return res.status(200).json({
    jobId: batchId,
    total: results.length,
    results
  });
});

app.get("/api/jobs/:jobId", requireSupabaseUser, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.userId !== req.user.id) {
    return res.status(404).json({ error: "Job not found." });
  }
  const { results, userId, ...jobDetails } = job;
  res.json(jobDetails);
});

app.get("/api/jobs/:jobId/results", requireSupabaseUser, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.userId !== req.user.id) {
    return res.status(404).json({ error: "Job not found." });
  }
  res.json({ jobId: job.id, total: job.results.length, results: job.results });
});

app.use((error, req, res, next) => {
  console.error("API error:", error.message);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "An unexpected server error occurred.",
    ...(error.code ? { code: error.code } : {})
  });
});

const server = http.createServer(app);
attachReelLookupWebSocket(server, ALLOWED_ORIGINS);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`ReelData API running on port ${PORT}`);
});
