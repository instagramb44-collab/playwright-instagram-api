async function processJob(job, provider) {
  console.log(`Starting creator lookup job: ${job.id}`);

  const results = [];

  for (const item of job.results) {
    if (item.status !== "Queued") {
      results.push(item);
      continue;
    }

    try {
      // Processing state is internal only and is never returned by the API.
      item.status = "Processing";
      const creator = await provider.getCreator(item.reelUrl);

      item.username = creator.username;
      item.profileName = creator.profileName;
      item.status = "Completed";
      item.errorMessage = null;
    } catch (error) {
      item.status = "Failed";
      item.errorMessage = "Creator lookup is currently unavailable.";
      console.error(
        `Creator lookup failed for job ${job.id}, Reel ${item.shortcode || "unknown"}:`,
        error.message
      );
    }

    results.push(item);
  }

  const completed = results.filter(
    item => item.status === "Completed"
  ).length;

  const failed = results.filter(
    item => item.status === "Failed"
  ).length;

  const pending = results.filter(
    item => item.status === "Queued" ||
            item.status === "Processing"
  ).length;

  return {
    ...job,
    results,
    completed,
    failed,
    pending,
    status: pending > 0
      ? "Processing"
      : failed > 0 && completed === 0
        ? "Failed"
        : "Completed"
  };
}

module.exports = { processJob };
