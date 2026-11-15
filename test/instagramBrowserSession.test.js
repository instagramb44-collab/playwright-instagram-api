const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
const savedStates = [];
const fakeState = { cookies: [{ name: "sessionid", value: "test-session" }], origins: [] };

function makeFakeBrowser() {
  const page = {
    navigatedTo: null,
    closed: false,
    screenshot: async () => Buffer.from("jpeg-frame"),
    isClosed() { return this.closed; },
    goto: async function (url) { this.navigatedTo = url; },
    mouse: {
      click: async () => {},
      wheel: async () => {}
    },
    keyboard: {
      type: async () => {},
      press: async () => {}
    }
  };
  const context = {
    newPage: async () => page,\n    route: async () => {},
    cookies: async () => fakeState.cookies,
    storageState: async () => ({ cookies: fakeState.cookies, origins: [] })
  };
  const browser = {
    newContext: async () => context,
    close: async () => { page.closed = true; }
  };
  return { browser, page, context };
}

const fake = makeFakeBrowser();
Module._load = function (request, parent, isMain) {
  if (request === "playwright") return { chromium: { launch: async () => fake.browser } };
  if (request === "./instagramConnectionStore" &&
      parent?.filename?.endsWith("instagramBrowserSession.js")) {
    return {
      saveStorageState: async (userId, state) => savedStates.push({ userId, state })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const sessions = require("../services/instagramBrowserSession");

test("starts a headless browser at Instagram login", async () => {
  const result = await sessions.startLoginSession("user-1");
  assert.ok(result.sessionId);
  assert.equal(result.expiresInSeconds, 600);
  assert.equal(fake.page.navigatedTo, "https://www.instagram.com/accounts/login/");
  await sessions.closeOwnedSession(result.sessionId, "user-1");
});

test("browser frames and inputs are restricted to the owning user", async () => {
  const { sessionId } = await sessions.startLoginSession("owner");
  assert.equal(await sessions.getFrame(sessionId, "other-user"), null);
  assert.equal(await sessions.getFrame(sessionId, "owner") instanceof Buffer, true);
  assert.equal(await sessions.sendInput(sessionId, "other-user", { action: "type", text: "secret" }), false);
  assert.equal(await sessions.sendInput(sessionId, "owner", { action: "type", text: "test" }), true);
  await assert.rejects(
    sessions.sendInput(sessionId, "owner", { action: "click", x: 5000, y: 2 }),
    /outside the browser viewport/
  );
  await sessions.closeOwnedSession(sessionId, "owner");
});

test("only saves storage state when an Instagram session cookie exists", async () => {
  fakeState.cookies = [];
  const incomplete = await sessions.startLoginSession("user-2");
  assert.equal(await sessions.completeLoginSession(incomplete.sessionId, "user-2"), false);
  assert.equal(savedStates.length, 0);
  await sessions.closeOwnedSession(incomplete.sessionId, "user-2");

  fakeState.cookies = [{ name: "sessionid", value: "test-session" }];
  const complete = await sessions.startLoginSession("user-3");
  assert.equal(await sessions.completeLoginSession(complete.sessionId, "user-3"), true);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].userId, "user-3");
});
