const test = require("node:test");
const assert = require("node:assert/strict");
const { launchChromium, installBrowserResourcePolicy, CHROMIUM_ARGS } = require("../services/chromiumBrowser");

test("launches Chromium headlessly with conservative background-process flags", async () => {
  let launchOptions;
  const fakeChromium = {
    launch: async options => {
      launchOptions = options;
      return { launched: true };
    }
  };

  const result = await launchChromium(fakeChromium);
  assert.deepEqual(result, { launched: true });
  assert.equal(launchOptions.headless, true);
  assert.ok(launchOptions.args.includes("--disable-background-networking"));
  assert.ok(launchOptions.args.includes("--disable-extensions"));
  assert.ok(launchOptions.args.includes("--no-sandbox"));
  assert.ok(CHROMIUM_ARGS.length > 0);
});

test("blocks media buffers but allows Instagram navigation and ordinary page resources", async () => {
  let handler;
  const context = {
    route: async (pattern, callback) => {
      assert.equal(pattern, "**/*");
      handler = callback;
    }
  };
  await installBrowserResourcePolicy(context, {
    allowTopLevelNavigation: url => url.hostname === "www.instagram.com"
  });

  const makeRoute = ({ type, navigation = false, parentFrame = null, url }) => {
    const actions = [];
    const route = {
      request: () => ({
        resourceType: () => type,
        isNavigationRequest: () => navigation,
        frame: () => ({ parentFrame: () => parentFrame }),
        url: () => url
      }),
      abort: async () => actions.push("abort"),
      continue: async () => actions.push("continue")
    };
    return { route, actions };
  };

  const media = makeRoute({ type: "media", url: "https://cdn.instagram.com/video.mp4" });
  await handler(media.route);
  assert.deepEqual(media.actions, ["abort"]);

  const instagramNavigation = makeRoute({
    type: "document", navigation: true, url: "https://www.instagram.com/accounts/login/"
  });
  await handler(instagramNavigation.route);
  assert.deepEqual(instagramNavigation.actions, ["continue"]);

  const externalNavigation = makeRoute({
    type: "document", navigation: true, url: "https://example.com/"
  });
  await handler(externalNavigation.route);
  assert.deepEqual(externalNavigation.actions, ["abort"]);

  const image = makeRoute({ type: "image", url: "https://www.instagram.com/static/image.png" });
  await handler(image.route);
  assert.deepEqual(image.actions, ["continue"]);
});
