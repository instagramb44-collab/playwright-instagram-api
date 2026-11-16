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
    loginFormVisible: true,
    isClosed() { return this.closed; },
    locator: function () {
      const page = this;
      return {
        waitFor: async () => {
          if (!page.loginFormVisible) throw new Error("login form timeout");
        }
      };
    },
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
    newPage: async () => page,
    route: async () => {},
    cookies: async () => fakeState.cookies,
    storageState: async () => ({ cookies: fakeState.cookies, origins: [] })
  };
  const browser = {
    newContext: async () => context,
    close: async () => { page.closed = true; }
  };
  return { browser, page, context };
}

const activeFakes = [];
let launchOverride = null;
Module._load = function (request, parent, isMain) {
  if (request === "playwright") {
    return {
      chromium: {
        launch: async () => {
          if (launchOverride) return launchOverride();
          const fake = makeFakeBrowser();
          activeFakes.push(fake);
          return fake.browser;
        }
      }
    };
  }
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
  assert.equal(activeFakes.at(-1).page.navigatedTo, "https://www.instagram.com/accounts/login/");
  await sessions.closeOwnedSession(result.sessionId, "user-1");
});

test("does not create a session when the Instagram login form is missing", async () => {
  const fake = makeFakeBrowser();
  fake.page.loginFormVisible = false;
  activeFakes.push(fake);
  // Override the shared mocked launcher used by the already-imported service.
  launchOverride = async () => fake.browser;
  await assert.rejects(
    sessions.startLoginSession("blank-page-user"),
    error => error.status === 502 && error.code === "INSTAGRAM_LOGIN_PAGE_NOT_READY"
  );
  assert.equal(fake.page.closed, true);
  launchOverride = null;
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

test("allows two different users to hold separate sessions at the same time", async () => {
  const first = await sessions.startLoginSession("multi-user-1");
  const second = await sessions.startLoginSession("multi-user-2");
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(await sessions.getFrame(first.sessionId, "multi-user-1") instanceof Buffer, true);
  assert.equal(await sessions.getFrame(second.sessionId, "multi-user-2") instanceof Buffer, true);
  await sessions.closeOwnedSession(first.sessionId, "multi-user-1");
  await sessions.closeOwnedSession(second.sessionId, "multi-user-2");
});

test("enforces a safe global browser limit and does not evict another user", async () => {
  const first = await sessions.startLoginSession("capacity-user-1");
  const second = await sessions.startLoginSession("capacity-user-2");
  await assert.rejects(
    sessions.startLoginSession("capacity-user-3"),
    error => error.status === 429 && error.code === "INSTAGRAM_BROWSER_CAPACITY"
  );
  assert.equal(await sessions.getFrame(first.sessionId, "capacity-user-1") instanceof Buffer, true);
  assert.equal(await sessions.getFrame(second.sessionId, "capacity-user-2") instanceof Buffer, true);
  await sessions.closeOwnedSession(first.sessionId, "capacity-user-1");
  await sessions.closeOwnedSession(second.sessionId, "capacity-user-2");
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
