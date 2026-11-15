const { spawnSync } = require("node:child_process");

if (process.env.SKIP_PLAYWRIGHT_BROWSER_INSTALL === "1") {
  console.log("Skipping Chromium download in this test environment.");
  process.exit(0);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["playwright", "install", "chromium"], {
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
