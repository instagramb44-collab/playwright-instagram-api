const express = require("express");
const { randomUUID } = require("crypto");
const { requireSupabaseUser } = require("./middleware/requireSupabaseUser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

const jobs = new Map();

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    const error = new Error("Supabase backend configuration is missing.");
    error.status = 503;
    throw error;
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Supabase database request failed:", response.status, detail);
    const error = new Error("Could not update Instagram connection data.");
    error.status = 502;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function validateReelUrl(input) {
  try {
    const url = new URL(input.trim());

    if (!["instagram.com", "www.instagram.com"].includes(url.hostname)) {
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
    const rows = await supabaseRequest(
      `instagram_connections?select=status,connected_at,updated_at&user_id=eq.${encodeURIComponent(req.user.id)}&limit=1`
    );
    const connection = rows[0] || null;
    res.json({
      status: connection?.status || "disconnected",
      connectedAt: connection?.connected_at || null,
      updatedAt: connection?.updated_at || null
    });
  } catch (error) {
    next(error);
  }
});

// Disconnect removes the saved encrypted state. No browser cookies or tokens are returned.
app.delete("/api/instagram/connection", requireSupabaseUser, async (req, res, next) => {
  try {
    await supabaseRequest(
      `instagram_connections?user_id=eq.${encodeURIComponent(req.user.id)}`,
      { method: "DELETE" }
    );
    res.json({ status: "disconnected" });
  } catch (error) {
    next(error);
  }
});

// Job APIs now require a verified user and keep jobs isolated in this process.
app.post("/api/jobs", requireSupabaseUser, (req, res) => {
  const { urls } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Please provide an array of Reel URLs." });
  }
  if (urls.length > 100) {
    return res.status(400).json({ error: "Maximum 100 Reel URLs allowed per batch." });
  }

  const results = urls.map((input) => {
    const parsed = typeof input === "string" ? validateReelUrl(input) : null;
    return {
      id: randomUUID(),
      reelUrl: parsed ? parsed.normalizedUrl : String(input),
      shortcode: parsed?.shortcode || null,
      username: null,
      status: parsed ? "Queued" : "Failed",
      errorMessage: parsed ? null : "Invalid Instagram Reel URL"
    };
  });

  const jobId = randomUUID();
  const job = {
    id: jobId,
    userId: req.user.id,
    totalUrls: results.length,
    completed: 0,
    pending: results.filter(item => item.status === "Queued").length,
    failed: results.filter(item => item.status === "Failed").length,
    status: "Queued",
    createdAt: new Date().toISOString(),
    results
  };

  jobs.set(jobId, job);
  res.status(201).json({ message: "Import job created successfully.", job: { ...job, userId: undefined } });
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
    error: error.status ? error.message : "An unexpected server error occurred."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ReelData API running on port ${PORT}`);
});
