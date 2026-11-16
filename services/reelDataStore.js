const DATA_URL = process.env.DATA_SUPABASE_URL || "https://idsvtzsravxgxpotkfzc.supabase.co";
const DATA_KEY = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;

function config() {
  if (!DATA_KEY) throw new Error("ReelData data storage is not configured.");
  return { url: DATA_URL.replace(/\/$/, ""), key: DATA_KEY };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = response.status === 204 ? null : await response.text();
  if (!response.ok) {
    console.error("ReelData persistence error:", response.status, body);
    throw new Error("Unable to save ReelData workspace data.");
  }
  if (!body) return null;
  return JSON.parse(body);
}

const encode = value => encodeURIComponent(String(value));

async function ensureProfile(user) {
  await request("profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: user.id,
      email: user.email || null,
      updated_at: new Date().toISOString()
    })
  });
}

async function getInstagramPlatformId() {
  const rows = await request("scraper_platforms?select=id&platform_key=eq.instagram&enabled=eq.true&limit=1");
  if (!rows?.[0]?.id) throw new Error("Instagram scraping is not enabled in the platform settings.");
  return rows[0].id;
}

async function createJob(user, urls, metadata = {}) {
  await ensureProfile(user);
  const platformId = await getInstagramPlatformId();
  const rows = await request("scraper_jobs?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: user.id,
      platform_id: platformId,
      job_type: "reels",
      status: "processing",
      total_items: urls.length,
      request_metadata: metadata
    })
  });
  const job = rows?.[0];
  if (!job?.id) throw new Error("Unable to create the ReelData job.");
  return job.id;
}

async function createItem(jobId, userId, inputUrl, normalizedUrl) {
  const rows = await request("scraper_job_items?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      job_id: jobId,
      user_id: userId,
      input_url: inputUrl,
      normalized_url: normalizedUrl,
      item_type: "reel",
      status: "processing",
      attempt_count: 1
    })
  });
  if (!rows?.[0]?.id) throw new Error("Unable to create a ReelData job item.");
  return rows[0].id;
}

async function saveResult(itemId, userId, reelUrl, shortcode, creator) {
  await request("scraper_results", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      job_item_id: itemId,
      user_id: userId,
      content_type: "reel",
      source_url: reelUrl,
      canonical_url: reelUrl,
      platform_content_id: shortcode,
      username: creator.username || null,
      profile_name: creator.profileName || null,
      metrics: {},
      extracted_data: {
        profile_url: creator.profileUrl || null
      }
    })
  });
}

async function finishItem(itemId, userId, status, errorMessage = null) {
  await request(`scraper_job_items?id=eq.${encode(itemId)}&user_id=eq.${encode(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      error_message: errorMessage,
      processed_at: new Date().toISOString()
    })
  });
}

async function finishJob(jobId, userId, total, completed, failed) {
  const status = completed === total ? "completed" : completed > 0 ? "partially_completed" : "failed";
  await request(`scraper_jobs?id=eq.${encode(jobId)}&user_id=eq.${encode(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      completed_items: completed,
      failed_items: failed,
      completed_at: new Date().toISOString()
    })
  });
  await request("usage_records", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      job_id: jobId,
      event_type: "scrape",
      urls_submitted: total,
      urls_processed: completed
    })
  });
}

async function getJob(jobId, userId) {
  const rows = await request(
    `scraper_jobs?select=id,user_id,platform_id,job_type,status,total_items,completed_items,failed_items,request_metadata,error_message,created_at,started_at,completed_at&id=eq.${encode(jobId)}&user_id=eq.${encode(userId)}&limit=1`
  );
  return rows?.[0] || null;
}

async function getJobResults(jobId, userId) {
  const items = await request(
    `scraper_job_items?select=id,job_id,input_url,normalized_url,status,error_message,created_at,processed_at&job_id=eq.${encode(jobId)}&user_id=eq.${encode(userId)}&order=created_at.asc`
  );
  if (!items?.length) return [];

  const ids = items.map(item => item.id);
  const inFilter = ids.map(encode).join(",");
  const records = await request(
    `scraper_results?select=id,job_item_id,content_type,source_url,canonical_url,platform_content_id,username,profile_name,published_at,metrics,extracted_data,scraped_at&user_id=eq.${encode(userId)}&job_item_id=in.(${inFilter})`
  );
  const byItem = new Map((records || []).map(record => [record.job_item_id, record]));

  return items.map(item => {
    const record = byItem.get(item.id);
    if (!record) {
      return {
        id: item.id,
        reelUrl: item.normalized_url,
        creator: null,
        username: null,
        profileName: null,
        profileUrl: null,
        status: item.status,
        error: item.error_message || null
      };
    }
    const creator = {
      username: record.username,
      profileName: record.profile_name,
      profileUrl: record.extracted_data?.profile_url || null
    };
    return {
      id: item.id,
      reelUrl: record.canonical_url || record.source_url,
      creator,
      ...creator,
      status: item.status,
      metrics: record.metrics,
      scrapedAt: record.scraped_at
    };
  });
}

async function listWorkspace(userId) {
  const filter = `user_id=eq.${encode(userId)}`;
  const [jobs, items, results] = await Promise.all([
    request(`scraper_jobs?select=id,job_type,status,total_items,completed_items,failed_items,request_metadata,created_at,completed_at&${filter}&order=created_at.desc&limit=200`),
    request(`scraper_job_items?select=id,job_id,input_url,normalized_url,status,error_message,created_at,processed_at&${filter}&order=created_at.desc&limit=1000`),
    request(`scraper_results?select=id,job_item_id,content_type,source_url,canonical_url,platform_content_id,username,profile_name,published_at,metrics,extracted_data,scraped_at&${filter}&order=scraped_at.desc&limit=1000`)
  ]);
  return { jobs: jobs || [], items: items || [], results: results || [] };
}

module.exports = { createJob, createItem, saveResult, finishItem, finishJob, getJob, getJobResults, listWorkspace };
