const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-sync",
  "--disable-translate",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-component-update",
  "--disable-breakpad",
  "--disable-crash-reporter"
];

function launchChromium(chromium) {
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS });
}

async function installBrowserResourcePolicy(context, options = {}) {
  const allowTopLevelNavigation = options.allowTopLevelNavigation || (() => true);
  const logPrefix = options.logPrefix || "[Browser]";

  await context.route("**/*", async route => {
    const request = route.request();

    // Reel playback is not required for creator extraction or account login.
    // Blocking video/audio avoids allocating media buffers on the small Free instance.
    if (request.resourceType() === "media") {
      return route.abort();
    }

    if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
      let url;
      try {
        url = new URL(request.url());
      } catch {
        return route.abort();
      }

      if (!allowTopLevelNavigation(url)) {
        console.warn(logPrefix + " blocked top-level redirect", {
          hostname: url.hostname,
          resourceType: request.resourceType()
        });
        return route.abort();
      }
    }

    return route.continue();
  });
}

module.exports = { launchChromium, installBrowserResourcePolicy, CHROMIUM_ARGS };
