const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepareExtension } = require("../scripts/build.cjs");
const { createServer } = require("../scripts/demo.cjs");

async function waitUntil(check) {
  const deadline = Date.now() + 8000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("Private browsing state was not reached");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test("private search storage in Chrome", { timeout: 90000 }, async t => {
  const testDirectory = path.resolve(__dirname, "../test-results");
  await fs.mkdir(testDirectory, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(testDirectory, "search-tabs-private-"));
  const extension = prepareExtension("chrome", path.join(temporary, "extension"));
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  t.after(async () => {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temporary)), testDirectory);
    assert.ok(path.basename(temporary).startsWith("search-tabs-private-"));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const launch = () => chromium.launchPersistentContext(path.join(temporary, "profile"), {
    channel: "chromium", headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context = await launch();
  const background = async (fn, arg) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    return worker.evaluate(fn, arg);
  };
  const extensionId = await background(() => chrome.runtime.id);
  const management = await context.newPage();
  await management.goto("chrome://extensions/");
  await management.evaluate(() => new Promise((resolve, reject) => {
    chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve());
  }));
  await management.evaluate(id => new Promise((resolve, reject) => {
    chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, incognitoAccess: true }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  }), extensionId);
  await waitUntil(async () => {
    const info = await management.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
    return info.state === "ENABLED" && info.incognitoAccess.isEnabled;
  });
  await management.close();
  const regular = context.pages()[0];
  await regular.goto(origin);
  const settings = await context.newPage();
  await waitUntil(async () => {
    try { await settings.goto(`chrome-extension://${extensionId}/options.html`); return true; } catch { return false; }
  });
  await settings.evaluate(async origin => {
    const tab = (await chrome.tabs.query({})).find(tab => !tab.incognito && tab.url?.startsWith(origin));
    await chrome.runtime.sendMessage({ type: "search-tabs:site-status", tabId: tab.id, origin });
  }, origin);
  assert.equal(await background(() => chrome.extension.isAllowedIncognitoAccess()), true);
  await background(async origin => {
    const tab = (await chrome.tabs.query({})).find(tab => !tab.incognito && tab.url?.startsWith(origin));
    await enableSite(tab);
  }, origin);
  await regular.locator(".global-search-input").fill("regular only");
  await regular.locator(".global-search-input").press("Enter");
  const send = message => settings.evaluate(message => chrome.runtime.sendMessage(message), message);
  const stored = area => background(area => chrome.storage[area].get(null), area);
  const key = `searches:${origin}/:7`;
  const metadata = `searchSettings:${origin}/:7`;
  await waitUntil(async () => (await stored("local"))[key]?.includes("regular only"));
  let privateWindow;
  let otherPrivateWindow;
  let privateTab;

  async function privatePage(action, value = null) {
    return background(async ({ tabId, action, value }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args: [action, value], func: (action, value) => {
        if (action === "search") {
          const input = document.querySelector(".global-search-input");
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.closest("form").requestSubmit();
        } else if (action === "rename") {
          const tab = [...document.querySelectorAll(".zms-tab")].find(tab => tab.dataset.zmsQuery === value.query);
          tab.querySelector(".zms-rename").click();
          const input = document.querySelector(".zms-name-editor");
          input.value = value.name;
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        } else if (action === "account") userId = value;
        return {
          ready: typeof App !== "undefined", builder: Boolean(document.querySelector(".zms-builder-launch")), documentStarted: performance.timeOrigin,
          tabs: [...document.querySelectorAll(".zms-tab")].map(tab => ({ query: tab.dataset.zmsQuery, name: tab.querySelector(".nav-tab-name").textContent }))
        };
      } });
      return result.result;
    }, { tabId: privateTab, action, value });
  }
  async function openPrivate() {
    privateWindow = await background(origin => chrome.windows.create({ incognito: true, url: origin }), origin);
    privateTab = privateWindow.tabs[0].id;
    await waitUntil(async () => (await privatePage("state")).ready);
  }
  async function enablePrivate() {
    assert.deepEqual(await send({ type: "search-tabs:enable", tabId: privateTab, origin }), { ok: true });
    await waitUntil(async () => (await privatePage("state")).builder);
  }

  await t.test("temporary private queries and names stay out of persistent storage", async () => {
    await openPrivate();
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), privateTab), "");
    otherPrivateWindow = await background(() => chrome.windows.create({ incognito: true, url: "about:blank" }));
    assert.equal((await privatePage("state")).builder, false);
    await enablePrivate();
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), privateTab), "ON");
    await privatePage("search", "private secret");
    await waitUntil(async () => (await privatePage("state")).tabs.length === 1);
    await privatePage("rename", { query: "private secret", name: "Private name" });
    await privatePage("search", "private current");
    await waitUntil(async () => (await stored("session"))[`private:${metadata}`]?.names["private secret"] === "Private name");
    assert.deepEqual((await stored("local"))[key], ["regular only"]);
    assert.equal(JSON.stringify(await stored("local")).includes("private secret"), false);
    const beforeReload = await privatePage("state");
    await background(tabId => chrome.tabs.reload(tabId), privateTab);
    await waitUntil(async () => {
      const state = await privatePage("state");
      return state.documentStarted !== beforeReload.documentStarted && state.tabs.some(tab => tab.name === "Private name");
    });
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), privateTab), "ON");
    assert.equal((await privatePage("state")).tabs.some(tab => tab.query === "regular only"), false);
    const rejected = await background(async ({ origin, key }) => {
      const tab = (await chrome.tabs.query({})).find(tab => !tab.incognito && tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [key], func: key => chrome.runtime.sendMessage({ type: "search-tabs:private-data", operation: "read", keys: [key] }) });
      return result.result;
    }, { origin, key });
    assert.equal(rejected.ok, false);
  });

  await t.test("shared mode keeps private changes in the regular account without merging temporary searches", async () => {
    await settings.locator("#share-private-searches").check();
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.query === "regular only"));
    assert.equal((await privatePage("state")).tabs.some(tab => tab.query === "private secret"), false);
    await privatePage("search", "shared from private");
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.query === "shared from private"));
    await privatePage("rename", { query: "shared from private", name: "Shared name" });
    await waitUntil(async () => (await stored("local"))[metadata]?.names["shared from private"] === "Shared name");
    await waitUntil(async () => (await regular.locator(".zms-tab").allTextContents()).some(name => name.includes("Shared name")));
    await privatePage("account", "8");
    await waitUntil(async () => (await privatePage("state")).tabs.length === 0);
    await privatePage("search", "account eight private");
    await waitUntil(async () => (await stored("local"))[`searches:${origin}/:8`]?.includes("account eight private"));
    assert.equal((await stored("local"))[key].includes("account eight private"), false);
    await privatePage("account", "7");
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Shared name"));
    await settings.locator("#share-private-searches").uncheck();
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Private name"));
    assert.equal((await stored("local"))[metadata].names["shared from private"], "Shared name");
    await settings.locator("#share-private-searches").check();
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Shared name"));
  });

  await t.test("disabling a regular site keeps its private integration and uses temporary registrations", async () => {
    const tabId = await background(async origin => (await chrome.tabs.query({})).find(tab => !tab.incognito && tab.url?.startsWith(origin)).id, origin);
    assert.deepEqual(await send({ type: "search-tabs:disable", tabId, origin }), { ok: true, accessRemoved: true });
    await waitUntil(async () => await regular.locator(".zms-builder-launch").count() === 0);
    assert.equal((await privatePage("state")).builder, true);
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), privateTab), "ON");
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), tabId), "");
    assert.equal(await background(async () => (await chrome.scripting.getRegisteredContentScripts()).every(script => script.persistAcrossSessions === false)), true);
    assert.deepEqual(await send({ type: "search-tabs:enable", tabId, origin }), { ok: true });
    await waitUntil(async () => await regular.locator(".zms-builder-launch").count() === 1);
    assert.equal(await background(async () => (await chrome.scripting.getRegisteredContentScripts()).every(script => script.persistAcrossSessions === true)), true);
  });

  await t.test("only the last private window clears temporary data and shared searches remain", async () => {
    await background(id => chrome.windows.remove(id), privateWindow.id);
    assert.ok((await stored("session"))[`private:${key}`]?.includes("private secret"));
    await background(id => chrome.windows.remove(id), otherPrivateWindow.id);
    await waitUntil(async () => !Object.keys(await stored("session")).some(key => key.startsWith("private:")));
    assert.ok((await stored("local"))[key].includes("shared from private"));
    assert.equal(JSON.stringify(await stored("local")).includes("private secret"), false);
    assert.equal(await regular.locator(".zms-builder-launch").count(), 1);
    await openPrivate();
    assert.equal((await privatePage("state")).builder, false);
    assert.equal(await background(tabId => chrome.action.getBadgeText({ tabId }), privateTab), "");
    await enablePrivate();
    await waitUntil(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Shared name"));
  });

  await t.test("clear waits for a pending private write and removes data in both modes", async () => {
    await settings.locator("#share-private-searches").uncheck();
    await waitUntil(async () => (await privatePage("state")).builder);
    await background(() => {
      const set = chrome.storage.session.set.bind(chrome.storage.session);
      chrome.storage.session.set = data => {
        if (!Object.values(data).some(value => Array.isArray(value) && value.includes("late private write"))) return set(data);
        chrome.storage.session.set = set;
        return new Promise((resolve, reject) => { globalThis.releasePrivateWrite = () => set(data).then(resolve, reject); });
      };
    });
    await privatePage("search", "late private write");
    await waitUntil(async () => background(() => Boolean(globalThis.releasePrivateWrite)));
    const clearing = send({ type: "search-tabs:clear" });
    await waitUntil(async () => !(await privatePage("state")).builder);
    await background(() => globalThis.releasePrivateWrite());
    assert.equal((await clearing).ok, true);
    assert.deepEqual(await stored("local"), { enabledSites: [] });
    assert.deepEqual(await stored("session"), {});
    assert.equal((await privatePage("state")).tabs.length, 0);
  });
});
