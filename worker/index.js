
const { chromium } = require("playwright");

async function startWorker() {
  console.log("ReelData worker starting...");

  let browser;

  try {
    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage();

    await page.goto("https://example.com");

    console.log("Worker browser is ready.");
    console.log("Test page:", await page.title());
  } catch (error) {
    console.error("Worker error:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

startWorker();
