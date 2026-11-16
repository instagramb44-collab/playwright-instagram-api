const express = require("express");
const { randomUUID } = require("crypto");
const { processJob } = require("./worker/processor");
const { getCreator } = require("./worker/provider");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

// Completed jobs only. In-progress job state is never exposed through the API.
const jobs = new Map();

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

// Convert internal job state into a final-result-only API response.
// Internal statuses, counters, timestamps, and processing details stay private.
function toPublicJob(job) {
  return {
    jobId: job.id,
    total: job.results.length,
    results: job.results.map((item) => ({
      id: item.id,
      reelUrl: item.reelUrl,
      username: item.username,
      profileName: item.profileName,
      ...(item.errorMessage ? { error: item.errorMessage } : {})
    }))
  };
}

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "ReelData API"
  });
});

// Keep this request open until processing finishes. No queued/processing
// response or progress endpoint is sent to the frontend.
app.post("/api/jobs", async (req, res) => {
  const { urls } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      error: "Please provide an array of Reel URLs."
    });
  }

  if (urls.length > 100) {
    return res.status(400).json({
      error: "Maximum 100 Reel URLs allowed per batch."
    });
  }

  const results = urls.map((input) => {
    const parsed = typeof input === "string" ? validateReelUrl(input) : null;

    return {
      id: randomUUID(),
      reelUrl: parsed ? parsed.normalizedUrl : String(input),
      shortcode: parsed?.shortcode || null,
      username: null,
      profileName: null,
      status: parsed ? "Queued" : "Failed",
      errorMessage: parsed ? null : "Invalid Instagram Reel URL"
    };
  });

  const job = {
    id: randomUUID(),
    totalUrls: results.length,
    completed: 0,
    pending: results.filter(item => item.status === "Queued").length,
    failed: results.filter(item => item.status === "Failed").length,
    status: "Queued",
    createdAt: new Date().toISOString(),
    results
  };

  try {
    const completedJob = await processJob(job, { getCreator });
    jobs.set(completedJob.id, completedJob);
    return res.status(200).json(toPublicJob(completedJob));
  } catch (error) {
    console.error("Creator lookup job failed:", error);
    return res.status(500).json({
      error: "Creator lookup failed. Please try again."
    });
  }
});

// This endpoint returns completed results only, never live job state.
app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Completed job not found." });
  }

  res.json(toPublicJob(job));
});

app.get("/api/jobs/:jobId/results", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Completed job not found." });
  }

  res.json(toPublicJob(job));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ReelData API running on port ${PORT}`);
});
