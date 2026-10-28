const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { launchFirefox } = require("./helpers/firefox.cjs");
const { prepareExtension } = require("../scripts/build.cjs");
const { createServer } = require("../scripts/demo.cjs");

test("shared extension in Firefox", { timeout: 90000 }, async t => {
  const project = path.resolve(__dirname, "..");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "search-tabs-firefox-"));
  const extension = prepareExtension("firefox", path.join(temporary, "extension"));
  const manifest = JSON.parse(await fs.readFile(path.join(extension, "manifest.json"), "utf8"));
  const extensionId = manifest.browser_specific_settings.gecko.id;
  const uuid = "863bf46e-8ff9-4a67-9f7d-162eb068f2a3";
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let firefox;
  t.after(async () => {
    await firefox?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("search-tabs-firefox-"));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  firefox = await launchFirefox({
    binary: process.env.FIREFOX_PATH || path.join(project, ".tools/browsers/firefox-1497/firefox/firefox.exe"),
    driver: process.env.GECKODRIVER_PATH || path.join(project, ".tools/geckodriver/geckodriver.exe"),
    uuid, extensionId
  });
  t.diagnostic(`Firefox ${firefox.version}`);
  assert.equal(await firefox.command("/moz/addon/install", { path: extension, temporary: true, allowPrivateBrowsing: true }), extensionId);
  await firefox.command("/window/rect", { width: 1440, height: 1000 });
  await firefox.navigate(origin);
  const appTab = await firefox.command("/window", null, "GET");
  await firefox.execute("window.testDocumentToken = 'same-zammad-document';");
  let settings = await firefox.command("/window/new", { type: "tab" });
  const settingsUrl = `moz-extension://${uuid}/options.html`;

  async function app() { await firefox.command("/window", { handle: appTab }); }
  async function settingsPage() {
    if (!(await firefox.command("/window/handles", null, "GET")).includes(settings.handle)) settings = await firefox.command("/window/new", { type: "tab" });
    await firefox.command("/window", { handle: settings.handle });
    await firefox.navigate(settingsUrl);
  }
  async function grantAccess() {
    await firefox.command("/moz/context", { context: "chrome" });
    try {
      await firefox.executeAsync("const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs'); await ExtensionPermissions.add(arguments[0], { permissions: [], origins: ['http://127.0.0.1/*'] }, WebExtensionPolicy.getByID(arguments[0]).extension);", extensionId);
    } finally {
      await firefox.command("/moz/context", { context: "content" });
    }
  }
  async function grantActiveTab() {
    await firefox.command("/moz/context", { context: "chrome" });
    try {
      await firefox.execute("const { BrowserWindowTracker } = ChromeUtils.importESModule('resource:///modules/BrowserWindowTracker.sys.mjs'); const window = BrowserWindowTracker.getTopWindow(); const tab = [...window.gBrowser.tabs].find(tab => tab.linkedBrowser.currentURI.spec.startsWith(arguments[1] + '/')); WebExtensionPolicy.getByID(arguments[0]).extension.tabManager.addActiveTabPermission(tab);", extensionId, origin);
    } finally {
      await firefox.command("/moz/context", { context: "content" });
    }
  }
  async function enable() {
    await grantAccess();
    await settingsPage();
    const result = await firefox.executeAsync("const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(arguments[0] + '/')); return await browser.runtime.sendMessage({ type: 'search-tabs:enable', tabId: tab.id, origin: arguments[0] });", origin);
    assert.deepEqual(result, { ok: true });
    await app();
  }
  async function waitFor(script, ...args) {
    const deadline = Date.now() + 6000;
    while (!await firefox.execute(script, ...args)) {
      if (Date.now() > deadline) throw new Error(`Firefox state was not reached: ${script}`);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }
  const queries = () => firefox.execute("return [...document.querySelectorAll('.zms-tab')].map(tab => tab.dataset.zmsQuery)");
  async function search(query, edit = false) {
    await firefox.execute("const input = document.querySelector(arguments[1] ? '.js-search' : '.global-search-input'); input.value = arguments[0]; input.dispatchEvent(new Event('input', { bubbles: true })); input.closest('form').requestSubmit();", query, edit);
    await waitFor("return document.querySelector('.js-search').value === arguments[0] && [...document.querySelectorAll('.zms-tab')].some(tab => tab.dataset.zmsQuery === arguments[0]);", query);
  }
  const click = selector => firefox.execute("document.querySelector(arguments[0]).click();", selector);
  const fill = (selector, value) => firefox.execute("const input = document.querySelector(arguments[0]); input.value = arguments[1]; input.dispatchEvent(new Event('input', { bubbles: true }));", selector, value);

  await t.test("granting site access finishes activation after the requesting panel closes", async () => {
    await grantActiveTab();
    await settingsPage();
    const prepared = await firefox.executeAsync("const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(arguments[0] + '/')); return await browser.runtime.sendMessage({ type: 'search-tabs:prepare-enable', tabId: tab.id, origin: arguments[0] });", origin);
    assert.deepEqual(prepared, { ok: true, pending: true });
    await firefox.command("/window", null, "DELETE");
    await app();
    await grantAccess();
    await waitFor("return document.querySelectorAll('.zms-builder-launch').length === 1");
    await settingsPage();
    assert.equal(await firefox.executeAsync("return Boolean((await browser.storage.local.get('pendingActivations')).pendingActivations)"), false);
    await app();
    await search("state.name:open");
    await search("drukarka / Łódź + 50% # &");
    assert.deepEqual(await queries(), ["state.name:open", "drukarka / Łódź + 50% # &"]);
    await click(".zms-tab");
    await waitFor("return document.querySelector('.js-search').value === 'state.name:open'");
    assert.equal(await firefox.execute("return window.testDocumentToken"), "same-zammad-document");
    assert.equal((await firefox.command("/window/handles", null, "GET")).length, 2);
  });

  await t.test("editing a query preserves its tab and survives reload", async () => {
    await search("state.name:closed", true);
    assert.deepEqual(await queries(), ["state.name:closed", "drukarka / Łódź + 50% # &"]);
    await firefox.command("/refresh");
    await waitFor("return document.querySelectorAll('.zms-tab').length === 2");
    assert.deepEqual(await queries(), ["state.name:closed", "drukarka / Łódź + 50% # &"]);
  });

  await t.test("groups, NOT and native modal controls work in Firefox", async () => {
    await click(".zms-builder-launch");
    await fill(".zms-builder-base", "printer");
    await click(".zms-builder-add-group");
    await click('.zms-builder-group [data-join="any"]');
    await click('.zms-builder-field[data-field="state"]');
    await click('.zms-builder-choice[data-value="open"]');
    await click('.zms-builder-field[data-field="priority"]');
    await click('.zms-builder-choice[data-value="3 high"]');
    await click(".zms-builder-group > .zms-builder-group-logic > .zms-builder-negate");
    const query = '(printer) AND (NOT ((state.name:"open") OR (priority.name:"3 high")))';
    assert.equal(await firefox.execute("return document.querySelector('.zms-builder-query').value"), query);
    assert.equal(await firefox.execute("return document.querySelector('.zms-builder-catalog').scrollHeight <= document.querySelector('.zms-builder-catalog').clientHeight + 1"), true);
    await fs.mkdir(path.join(project, "test-results"), { recursive: true });
    await fs.writeFile(path.join(project, "test-results/firefox-builder.png"), Buffer.from(await firefox.command("/screenshot", null, "GET"), "base64"));
    await click(".zms-builder-apply");
    await waitFor("return document.querySelector('.js-search').value === arguments[0]", query);
    assert.equal((await queries()).length, 2);
  });

  await t.test("extension reload restores registered scripts and saved searches", async () => {
    await firefox.command("/moz/context", { context: "chrome" });
    try {
      await firefox.executeAsync("const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const addon = await AddonManager.getAddonByID(arguments[0]); await addon.reload();", extensionId);
    } finally {
      await firefox.command("/moz/context", { context: "content" });
    }
    await app();
    await firefox.command("/refresh");
    await waitFor("return document.querySelectorAll('.zms-tab').length === 2");
    await settingsPage();
    assert.equal(await firefox.executeAsync("return (await browser.scripting.getRegisteredContentScripts()).length"), 2);
    await app();
  });

  await t.test("disable stops the current page, revokes access and stays off after reload", async () => {
    await settingsPage();
    const result = await firefox.executeAsync("return await browser.runtime.sendMessage({ type: 'search-tabs:disable', origin: arguments[0] });", origin);
    assert.deepEqual(result, { ok: true, accessRemoved: true });
    assert.deepEqual(await firefox.executeAsync("return (await browser.permissions.getAll()).origins"), []);
    assert.equal(await firefox.executeAsync("return Object.keys(await browser.storage.local.get(null)).some(key => key.startsWith('searches:'))"), true);
    await app();
    await waitFor("return document.querySelectorAll('.zms-tab, .zms-builder-launch').length === 0");
    await firefox.command("/refresh");
    assert.equal(await firefox.execute("return document.querySelectorAll('.zms-tab, .zms-builder-launch').length"), 0);
  });

  await t.test("clear removes saved searches and keeps the integration disabled", async () => {
    await enable();
    await waitFor("return document.querySelectorAll('.zms-tab').length === 2");
    await settingsPage();
    assert.deepEqual(await firefox.executeAsync("return await browser.runtime.sendMessage({ type: 'search-tabs:clear' });"), { ok: true, accessRemoved: true });
    assert.deepEqual(await firefox.executeAsync("return await browser.storage.local.get(null)"), { enabledSites: [] });
    assert.deepEqual(await firefox.executeAsync("return await browser.scripting.getRegisteredContentScripts()"), []);
    await app();
    await firefox.command("/refresh");
    assert.equal(await firefox.execute("return document.querySelectorAll('.zms-tab, .zms-builder-launch').length"), 0);
  });

  await t.test("revoking a Firefox host permission stops the integration", async () => {
    await enable();
    await search("permission removal");
    await settingsPage();
    await firefox.executeAsync("return await browser.permissions.remove({ origins: ['http://127.0.0.1/*'] });");
    await app();
    await waitFor("return document.querySelectorAll('.zms-tab, .zms-builder-launch').length === 0");
    await settingsPage();
    assert.deepEqual(await firefox.executeAsync("return await browser.storage.local.get('enabledSites')"), { enabledSites: [] });
  });

  await t.test("a pending activation cannot enable a tab that moved to another site", async () => {
    await grantActiveTab();
    await settingsPage();
    assert.deepEqual(await firefox.executeAsync("const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(arguments[0] + '/')); return await browser.runtime.sendMessage({ type: 'search-tabs:prepare-enable', tabId: tab.id, origin: arguments[0] });", origin), { ok: true, pending: true });
    await app();
    await firefox.navigate(`http://localhost:${server.address().port}`);
    await grantAccess();
    await settingsPage();
    await firefox.executeAsync("await new Promise(resolve => { const check = async () => { if (!(await browser.storage.local.get('pendingActivations')).pendingActivations) resolve(); else setTimeout(check, 50); }; check(); });");
    assert.deepEqual(await firefox.executeAsync("return await browser.storage.local.get('enabledSites')"), { enabledSites: [] });
    assert.deepEqual(await firefox.executeAsync("return await browser.scripting.getRegisteredContentScripts()"), []);
    await app();
    assert.equal(await firefox.execute("return document.querySelectorAll('.zms-tab, .zms-builder-launch').length"), 0);
  });

  await t.test("custom names and dragged tab positions survive Firefox reloads", async () => {
    await app();
    await firefox.navigate(origin);
    await enable();
    await search("Firefox named");
    await click(".zms-tab.is-active .zms-rename");
    await fill(".zms-name-editor", "Firefox saved");
    await firefox.execute("document.querySelector('.zms-name-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));");
    await search("Firefox named edited", true);
    assert.equal(await firefox.execute("return document.querySelector('.zms-tab.is-active .nav-tab-name').textContent;"), "Firefox saved");
    await search("Firefox last");
    const bounds = await firefox.execute("const tab = document.querySelector('.zms-tab.is-active').getBoundingClientRect(); const ticket = document.querySelector('[data-key=\"Ticket-1109\"]').getBoundingClientRect(); return { x: Math.round(tab.x + 45), y: Math.round(tab.y + tab.height / 2), target: Math.round(ticket.y + 3) };");
    await firefox.command("/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", duration: 0, x: bounds.x, y: bounds.y }, { type: "pointerDown", button: 0 },
      { type: "pointerMove", duration: 300, x: bounds.x, y: bounds.target }, { type: "pointerUp", button: 0 }
    ] }] });
    await waitFor("return document.querySelector('.tasks-navigation > .nav-tab').dataset.zmsQuery === 'Firefox last';");
    await settingsPage();
    await firefox.executeAsync("await new Promise(resolve => { const check = async () => { const key = 'searchSettings:' + arguments[0] + '/:7'; const value = (await browser.storage.local.get(key))[key]; if (value?.anchors['Firefox last'] === 'Ticket-1109' && value.names['Firefox named edited'] === 'Firefox saved') resolve(); else setTimeout(check, 50); }; check(); });", origin);
    await app();
    await firefox.command("/refresh");
    await waitFor("return document.querySelector('.tasks-navigation > .nav-tab')?.dataset.zmsQuery === 'Firefox last' && [...document.querySelectorAll('.zms-tab .nav-tab-name')].some(name => name.textContent === 'Firefox saved');");
  });

  await t.test("Firefox private windows isolate temporary data, support shared searches and clear the last session", async () => {
    await settingsPage();
    assert.equal(await firefox.executeAsync("return await browser.extension.isAllowedIncognitoAccess();"), true);
    const privateWindow = await firefox.executeAsync("return await browser.windows.create({ incognito: true, url: arguments[0] });", origin);
    const privateTab = privateWindow.tabs[0].id;
    const blankWindow = await firefox.executeAsync("return await browser.windows.create({ incognito: true, url: 'about:blank' });");
    const pageActions = (action, value) => {
      if (action === "search") {
        const input = document.querySelector(".global-search-input");
        input.value = value;
        input.closest("form").requestSubmit();
      } else if (action === "rename") {
        const tab = [...document.querySelectorAll(".zms-tab")].find(tab => tab.dataset.zmsQuery === value.query);
        tab.querySelector(".zms-rename").click();
        const input = document.querySelector(".zms-name-editor");
        input.value = value.name;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      return { ready: typeof App !== "undefined", builder: Boolean(document.querySelector(".zms-builder-launch")), tabs: [...document.querySelectorAll(".zms-tab")].map(tab => ({ query: tab.dataset.zmsQuery, name: tab.querySelector(".nav-tab-name").textContent })) };
    };
    const privatePage = (action, value) => firefox.executeAsync(`const [result] = await browser.scripting.executeScript({ target: { tabId: arguments[0] }, world: 'MAIN', func: ${pageActions.toString()}, args: [arguments[1], arguments[2]] }); return result.result;`, privateTab, action, value ?? null);
    const local = () => firefox.executeAsync("return await browser.storage.local.get(null);");
    const session = () => firefox.executeAsync("return await browser.storage.session.get(null);");
    const key = `searches:${origin}/:7`;
    async function waitPrivate(check) {
      const deadline = Date.now() + 8000;
      while (!await check()) {
        if (Date.now() > deadline) throw new Error("Firefox private state was not reached");
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }
    await waitPrivate(async () => (await privatePage("state")).ready);
    assert.equal((await privatePage("state")).builder, false);
    assert.deepEqual(await firefox.executeAsync("return await browser.runtime.sendMessage({ type: 'search-tabs:enable', tabId: arguments[0], origin: arguments[1] });", privateTab, origin), { ok: true });
    await waitPrivate(async () => (await privatePage("state")).builder);
    await privatePage("search", "Firefox private secret");
    await waitPrivate(async () => (await privatePage("state")).tabs.length === 1);
    await privatePage("rename", { query: "Firefox private secret", name: "Temporary Firefox name" });
    await privatePage("search", "Firefox private current");
    await waitPrivate(async () => (await session())[`private:${key}`]?.length === 2);
    assert.equal(JSON.stringify(await local()).includes("Firefox private secret"), false);
    await firefox.executeAsync("await browser.tabs.reload(arguments[0]);", privateTab);
    await waitPrivate(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Temporary Firefox name"));
    assert.deepEqual(await firefox.executeAsync("return await browser.runtime.sendMessage({ type: 'search-tabs:share-private', enabled: true });"), { ok: true });
    await waitPrivate(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Firefox saved"));
    assert.equal((await privatePage("state")).tabs.some(tab => tab.query === "Firefox private secret"), false);
    await privatePage("search", "Firefox shared query");
    await waitPrivate(async () => (await privatePage("state")).tabs.some(tab => tab.query === "Firefox shared query"));
    await privatePage("rename", { query: "Firefox shared query", name: "Shared Firefox name" });
    await waitPrivate(async () => JSON.stringify(await local()).includes("Shared Firefox name"));
    await firefox.executeAsync("return await browser.runtime.sendMessage({ type: 'search-tabs:share-private', enabled: false });");
    await waitPrivate(async () => (await privatePage("state")).tabs.some(tab => tab.name === "Temporary Firefox name"));
    await firefox.executeAsync("await browser.windows.remove(arguments[0]);", privateWindow.id);
    assert.ok((await session())[`private:${key}`].includes("Firefox private secret"));
    await firefox.executeAsync("await browser.windows.remove(arguments[0]);", blankWindow.id);
    await waitPrivate(async () => !Object.keys(await session()).some(key => key.startsWith("private:")));
    assert.ok((await local())[key].includes("Firefox shared query"));
    assert.equal(JSON.stringify(await local()).includes("Firefox private secret"), false);
    await app();
    assert.equal(await firefox.execute("return Boolean(document.querySelector('.zms-builder-launch'));"), true);
  });
});
