const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

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

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "ReelData API"
  });
});

app.post("/api/jobs", (req, res) => {
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
      status: parsed ? "Queued" : "Failed",
      errorMessage: parsed ? null : "Invalid Instagram Reel URL"
    };
  });

  const jobId = randomUUID();

  const job = {
    id: jobId,
    totalUrls: results.length,
    completed: 0,
    pending: results.filter(item => item.status === "Queued").length,
    failed: results.filter(item => item.status === "Failed").length,
    status: "Queued",
    createdAt: new Date().toISOString(),
    results
  };

  jobs.set(jobId, job);

  res.status(201).json({
    message: "Import job created successfully.",
    job
  });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  const { results, ...jobDetails } = job;
  res.json(jobDetails);
});

app.get("/api/jobs/:jobId/results", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  res.json({
    jobId: job.id,
    total: job.results.length,
    results: job.results
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ReelData API running on port ${PORT}`);
});
