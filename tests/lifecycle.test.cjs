const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createServer } = require("../scripts/demo.cjs");

test("extension recovery on existing Zammad pages", { timeout: 90000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "search-tabs-lifecycle-"));
  const extension = path.join(temporary, "extension");
  await fs.cp(path.join(__dirname, "../extension"), extension, { recursive: true });
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
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("search-tabs-lifecycle-"));
    await fs.rm(temporary, { recursive: true, force: true });
  });

  const launch = () => chromium.launchPersistentContext(path.join(temporary, "profile"), {
    channel: "chromium", headless: true, ignoreDefaultArgs: ["--disable-extensions", "about:blank"],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--restore-last-session"]
  });
  async function waitUntil(check) {
    const deadline = Date.now() + 10000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error("Expected integration state was not reached");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  context = await launch();
  const background = async (fn, value) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    let timeout;
    try {
      return await Promise.race([
        worker.evaluate(fn, value),
        new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error("Background API did not respond")), 5000); })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const extensionId = await background(() => chrome.runtime.id);
  let page = context.pages()[0] || await context.newPage();
  await page.goto(origin);
  let tabId = await background(async origin => {
    const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
    await enableSite(tab);
    return tab.id;
  }, origin);
  const badge = () => background(tabId => chrome.action.getBadgeText({ tabId }), tabId);
  async function search(query) {
    await page.locator(".global-search-input").fill(query);
    await page.locator(".global-search-input").press("Enter");
    await waitUntil(async () => page.locator(".zms-tab").evaluateAll((tabs, query) => tabs.some(tab => tab.dataset.zmsQuery === query), query));
  }
  async function waitForMessage(popup, key) {
    try {
      await waitUntil(async () => (await popup.locator("#status").textContent()) === await popup.evaluate(key => messages[key], key));
    } catch {
      assert.equal(await popup.locator("#status").textContent(), await popup.evaluate(key => messages[key], key));
    }
  }
  await search("before restart");
  const documentStarted = await page.evaluate(() => performance.timeOrigin);

  await t.test("disabling and re-enabling restores integration without reloading the document", async () => {
    const management = await context.newPage();
    try {
      await management.goto("chrome://extensions/");
      await management.evaluate(() => new Promise((resolve, reject) => {
        chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve());
      }));
      await management.evaluate(id => chrome.management.setEnabled(id, false), extensionId);
      await waitUntil(async () => page.locator(".zms-builder-launch").count().then(count => count === 0));
      await management.evaluate(id => chrome.management.setEnabled(id, true), extensionId);
      await waitUntil(async () => management.evaluate(id => new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(id, info => resolve(info.state === "ENABLED"));
      }), extensionId));
      await management.close();
      await page.bringToFront();
      await waitUntil(async () => page.locator(".zms-builder-launch").count().then(count => count === 1));
      await waitUntil(async () => (await badge()) === "ON");
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted);
      await search("after re-enable");
      assert.equal(await page.locator(".zms-tab").count(), 2);
    } finally {
      if (!management.isClosed()) await management.close();
    }
  });

  await t.test("opening the toolbar repairs a missing bridge and confirms working controls", async () => {
    await page.evaluate(() => document.dispatchEvent(new Event("zammad-multi-search:stop")));
    assert.equal(await page.evaluate(() => window.zammadMultiSearchBridge), false);
    const popup = await context.newPage();
    try {
      await popup.addInitScript(tabId => {
        const get = chrome.tabs.get.bind(chrome.tabs);
        chrome.tabs.query = async () => [await get(tabId)];
      }, tabId);
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await waitForMessage(popup, "success");
      assert.equal(await page.evaluate(() => window.zammadMultiSearchBridge), true);
      await search("after toolbar recovery");
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted);
      assert.equal(await page.locator(".zms-builder-launch").count(), 1);
    } finally {
      await popup.close();
    }
  });

  await t.test("a failed injection cannot report success or show ON", async () => {
    await page.evaluate(() => document.dispatchEvent(new Event("zammad-multi-search:stop")));
    await background(() => {
      globalThis.savedExecuteScript = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = details => details.files?.includes("content.js")
        ? Promise.reject(new Error("Test injection failure")) : globalThis.savedExecuteScript(details);
    });
    const popup = await context.newPage();
    try {
      await popup.addInitScript(tabId => {
        const get = chrome.tabs.get.bind(chrome.tabs);
        chrome.tabs.query = async () => [await get(tabId)];
      }, tabId);
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await waitForMessage(popup, "integrationError");
      assert.equal(await badge(), "");
      await background(() => { chrome.scripting.executeScript = globalThis.savedExecuteScript; });
      await waitForMessage(popup, "success");
      await search("after retry");
    } finally {
      await background(() => { chrome.scripting.executeScript = globalThis.savedExecuteScript; });
      await popup.close();
    }
  });

  await t.test("restarting the browser restores the saved page, searches and badge", async () => {
    const queries = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    await context.close();
    context = await launch();
    await waitUntil(async () => context.pages().some(tab => tab.url().startsWith(origin)));
    page = context.pages().find(tab => tab.url().startsWith(origin));
    await waitUntil(async () => page.locator(".zms-tab").count().then(count => count === queries.length));
    const settings = await context.newPage();
    try {
      await settings.goto(`chrome-extension://${extensionId}/options.html`);
      await waitUntil(async () => settings.evaluate(async origin => {
        const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
        return tab && await chrome.action.getBadgeText({ tabId: tab.id }) === "ON";
      }, origin));
    } finally {
      await settings.close();
    }
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), queries);
    await search("after browser restart");
  });
});
