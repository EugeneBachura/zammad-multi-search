const extensionApi = globalThis.browser || globalThis.chrome;
function sitePattern(origin) {
  const address = new URL(origin);
  return `${address.protocol}//${address.hostname}/*`;
}
const contentFiles = ["search-builder.js", "content.js"];
const styleFiles = ["tabs.css", "search-builder.css"];
const activationLifetime = 5 * 60 * 1000;
let pendingChange = Promise.resolve();
let pendingPrivateChange = Promise.resolve();
const pageStarts = new Map();

function changeSites(action) {
  const result = pendingChange.then(() => action());
  pendingChange = result.catch(() => {});
  return result;
}

function stateStorage(privateMode) {
  return privateMode ? extensionApi.storage.session : extensionApi.storage.local;
}

function stateKey(name, privateMode) {
  return privateMode ? `private:${name}` : name;
}

async function readState(name, privateMode = false) {
  const key = stateKey(name, privateMode);
  return (await stateStorage(privateMode).get(key))[key];
}

async function writeState(name, value, privateMode = false) {
  const key = stateKey(name, privateMode);
  if (privateMode && Array.isArray(value) && !value.length) await stateStorage(true).remove(key);
  else await stateStorage(privateMode).set({ [key]: value });
}

async function enabledSites(privateMode = false) {
  const sites = await readState("enabledSites", privateMode);
  return Array.isArray(sites) ? sites : [];
}

async function siteIsEnabled(origin, privateMode = false) {
  return (await enabledSites(privateMode)).includes(origin) && await extensionApi.permissions.contains({ origins: [sitePattern(origin)] });
}

function pageState() {
  try {
    const app = window.App;
    if (!app?.Session?.get) return app ? "loading" : "unsupported";
    if (!app.Session.get("id")) return "signIn";
    return app.TaskManager?.get && document.querySelector(".tasks.tasks-navigation") ? "ready" : "loading";
  } catch {
    return "loading";
  }
}

async function inspectPage(tabId) {
  try {
    const [page] = await extensionApi.scripting.executeScript({ target: { tabId }, world: "MAIN", func: pageState });
    return page?.result || "unknown";
  } catch {
    return "unknown";
  }
}

async function targetTab(tabId, origin) {
  const tab = await extensionApi.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || "") || new URL(tab.url).origin !== origin) throw new Error("The page has changed. Open the extension again.");
  return tab;
}

async function siteStatus(tabId, origin) {
  const tab = await targetTab(tabId, origin);
  const hasAccess = await extensionApi.permissions.contains({ origins: [sitePattern(origin)] });
  const privateMode = Boolean(tab.incognito);
  const enabled = hasAccess && (await enabledSites(privateMode)).includes(origin);
  const state = await inspectPage(tabId);
  const active = enabled && await startPage(tab).catch(() => false);
  await updateBadge(tabId, active);
  return { enabled, hasAccess, pageState: enabled && state === "ready" && !active ? "integrationError" : state, privateMode, sharedSearches: privateMode && await readState("sharePrivateSearches") === true };
}

async function setPrivateSharing(enabled) {
  const sites = await enabledSites(true);
  await stopTabs(sites, true);
  await extensionApi.storage.local.set({ sharePrivateSearches: enabled === true });
  const tabs = await extensionApi.tabs.query({});
  for (const tab of tabs) {
    if (!tab.incognito || !tab.url || !sites.includes(new URL(tab.url).origin)) continue;
    try { await enableSite(tab); } catch {}
  }
}

async function pendingActivations(privateMode = false) {
  const stored = await readState("pendingActivations", privateMode);
  return (Array.isArray(stored) ? stored : []).filter(request => {
    const age = Date.now() - request?.requestedAt;
    return request && Number.isInteger(request.tabId) && /^https?:\/\//.test(request.origin) && age >= 0 && age < activationLifetime;
  });
}

async function saveActivations(requests, privateMode = false) {
  if (requests.length) await writeState("pendingActivations", requests, privateMode);
  else await stateStorage(privateMode).remove(stateKey("pendingActivations", privateMode));
}

async function cancelActivation(tabId, origin, privateMode = false) {
  await saveActivations((await pendingActivations(privateMode)).filter(request => request.origin !== origin || (tabId !== undefined && request.tabId !== tabId)), privateMode);
}

async function completeActivation(request, privateMode = false) {
  if (!await extensionApi.permissions.contains({ origins: [sitePattern(request.origin)] })) return { pending: true };
  try {
    const tab = await targetTab(request.tabId, request.origin);
    if (Boolean(tab.incognito) !== privateMode) throw new Error("The window has changed.");
    const state = await inspectPage(tab.id);
    if (state !== "ready") return { ok: false, reason: state };
    if (!await siteIsEnabled(request.origin, privateMode)) await enableSite(tab);
    return {};
  } finally {
    await cancelActivation(request.tabId, request.origin, privateMode);
  }
}

async function prepareActivation(tabId, origin) {
  const tab = await targetTab(tabId, origin);
  const privateMode = Boolean(tab.incognito);
  const request = { tabId, origin, requestedAt: Date.now() };
  await saveActivations([...(await pendingActivations(privateMode)).filter(item => item.tabId !== tabId), request], privateMode);
  return completeActivation(request, privateMode);
}

async function resumeActivations() {
  for (const privateMode of [false, true]) {
    const requests = await pendingActivations(privateMode);
    await saveActivations(requests, privateMode);
    for (const request of requests) {
      try { await completeActivation(request, privateMode); } catch {}
    }
  }
}

function siteScripts(origin, persistent = true) {
  const siteId = Array.from(new TextEncoder().encode(origin), byte => byte.toString(16).padStart(2, "0")).join("");
  const settings = { matches: [sitePattern(origin)], runAt: "document_idle", persistAcrossSessions: persistent };

  return [
    { ...settings, id: `site-${siteId}-bridge`, js: ["bridge.js"], world: "MAIN" },
    { ...settings, id: `site-${siteId}-tabs`, js: contentFiles, css: styleFiles }
  ];
}

async function updateBadge(tabId, enabled) {
  const updates = [
    extensionApi.action.setBadgeText({ text: enabled ? "ON" : "", tabId }),
    extensionApi.action.setTitle({ title: enabled ? "Search Tabs for Zammad is enabled on this site" : extensionApi.i18n.getMessage("actionTitle"), tabId })
  ];
  if (enabled) updates.push(extensionApi.action.setBadgeBackgroundColor({ color: "#276b47", tabId }));
  await Promise.allSettled(updates);
}

async function integrationIsReady(tabId) {
  try {
    const result = await extensionApi.tabs.sendMessage(tabId, { type: "search-tabs:ping" }, { frameId: 0 });
    return result?.active === true;
  } catch {
    return false;
  }
}

function startPage(tab) {
  if (pageStarts.has(tab.id)) return pageStarts.get(tab.id);
  const starting = (async () => {
    if (await integrationIsReady(tab.id)) return true;
    await extensionApi.tabs.sendMessage(tab.id, { type: "search-tabs:stop" }, { frameId: 0 }).catch(() => {});
    await extensionApi.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => {
      document.dispatchEvent(new Event("zammad-multi-search:stop"));
    } });
    await extensionApi.scripting.insertCSS({ target: { tabId: tab.id }, files: styleFiles });
    await extensionApi.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"], world: "MAIN" });
    await extensionApi.scripting.executeScript({ target: { tabId: tab.id }, files: contentFiles });
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await integrationIsReady(tab.id)) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  })().finally(() => pageStarts.delete(tab.id));
  pageStarts.set(tab.id, starting);
  return starting;
}

async function refreshPage(tab) {
  const origin = /^https?:\/\//.test(tab.url || "") ? new URL(tab.url).origin : "";
  const enabled = Boolean(origin) && await siteIsEnabled(origin, Boolean(tab.incognito));
  const active = enabled && await startPage(tab).catch(() => false);
  await updateBadge(tab.id, active);
}

async function restorePages() {
  const tabs = await extensionApi.tabs.query({ active: true });
  await Promise.allSettled(tabs.map(refreshPage));
}

async function enableSite(tab) {
  const origin = new URL(tab.url).origin;
  const privateMode = Boolean(tab.incognito);
  await writeState("enabledSites", [...new Set([...(await enabledSites(privateMode)), origin])], privateMode);
  const scripts = siteScripts(origin, (await enabledSites()).includes(origin));
  const registered = await extensionApi.scripting.getRegisteredContentScripts({ ids: scripts.map(script => script.id) });
  const missing = scripts.filter(script => !registered.some(existing => existing.id === script.id));

  if (missing.length) {
    await extensionApi.scripting.registerContentScripts(missing);
  }

  const existing = scripts.filter(script => registered.some(item => item.id === script.id));
  if (existing.length) await extensionApi.scripting.updateContentScripts(existing);

  const active = await startPage(tab);
  await updateBadge(tab.id, active);
  if (!active) throw new Error("Search tabs did not start on this page.");
}

async function stopTabs(origins, privateMode) {
  if (origins && !origins.length) return;
  const tabs = await extensionApi.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => tab.id && (privateMode === undefined || Boolean(tab.incognito) === privateMode)).map(async tab => {
    const result = await extensionApi.tabs.sendMessage(tab.id, { type: "search-tabs:stop", origins });
    if (!result?.ok) return;
    await updateBadge(tab.id, false);
    await extensionApi.scripting.removeCSS({ target: { tabId: tab.id }, files: styleFiles }).catch(() => {});
  }));
}

async function removeAccess(origins) {
  if (!origins.length) return true;
  try {
    return await extensionApi.permissions.remove({ origins });
  } catch {
    return false;
  }
}

async function disableSite(origin, privateMode = false) {
  await cancelActivation(undefined, origin, privateMode);
  await writeState("enabledSites", (await enabledSites(privateMode)).filter(site => site !== origin), privateMode);
  const scripts = await extensionApi.scripting.getRegisteredContentScripts();
  const siteIds = siteScripts(origin).map(script => script.id);
  const ids = scripts.filter(script => siteIds.includes(script.id)).map(script => script.id);
  if (ids.length) {
    if ((await enabledSites(!privateMode)).includes(origin)) await extensionApi.scripting.updateContentScripts(siteScripts(origin, (await enabledSites()).includes(origin)));
    else await extensionApi.scripting.unregisterContentScripts({ ids });
  }
  await stopTabs([origin], privateMode);
  const pattern = sitePattern(origin);
  const shared = [...await enabledSites(), ...await enabledSites(true)].some(site => sitePattern(site) === pattern);
  return { accessRemoved: shared || await removeAccess([pattern]) };
}

async function disableAndClear() {
  await extensionApi.storage.local.set({ enabledSites: [] });
  await writeState("enabledSites", [], true);
  const scripts = await extensionApi.scripting.getRegisteredContentScripts();
  const ids = scripts.filter(script => script.id.startsWith("site-")).map(script => script.id);
  if (ids.length) await extensionApi.scripting.unregisterContentScripts({ ids });
  await stopTabs();
  await extensionApi.storage.local.clear();
  await extensionApi.storage.local.set({ enabledSites: [] });
  await clearPrivateData();
  const { origins = [] } = await extensionApi.permissions.getAll();
  return { accessRemoved: await removeAccess(origins) };
}

async function clearPrivateData() {
  await pendingPrivateChange;
  const stored = await extensionApi.storage.session.get(null);
  const keys = Object.keys(stored).filter(key => key.startsWith("private:"));
  if (keys.length) await extensionApi.storage.session.remove(keys);
  return keys.length > 0;
}

async function closePrivateSession() {
  if ((await extensionApi.windows.getAll()).some(window => window.incognito)) return;
  const sites = await enabledSites(true);
  if (!await clearPrivateData()) return;
  await reconcileSites();
  const ordinarySites = await enabledSites();
  const patterns = [...new Set(sites.map(sitePattern))].filter(pattern => !ordinarySites.some(site => sitePattern(site) === pattern));
  if (patterns.length) await removeAccess(patterns);
}

async function privateData(message, sender) {
  if (!sender.tab?.incognito || sender.frameId !== 0) throw new Error("Private page access is required.");
  const page = new URL(sender.url);
  const tab = await targetTab(sender.tab.id, page.origin);
  if (!tab.incognito || !await siteIsEnabled(page.origin, true)) throw new Error("This private site is disabled.");
  const keys = message.operation === "read" ? message.keys : Object.keys(message.data || {});
  const prefixes = ["searches:", "searchSettings:"].map(prefix => `${prefix}${page.origin}${page.pathname}:`);
  if (!Array.isArray(keys) || !keys.length || keys.length > 2 || !keys.every(key => typeof key === "string" && prefixes.some(prefix => key.startsWith(prefix) && key.length > prefix.length))) {
    throw new Error("Invalid private storage keys.");
  }
  if (message.operation === "read") {
    const stored = await extensionApi.storage.session.get(keys.map(key => stateKey(key, true)));
    return { data: Object.fromEntries(keys.map(key => [key, stored[stateKey(key, true)]])) };
  }
  if (message.operation !== "write") throw new Error("Invalid private storage operation.");
  await extensionApi.storage.session.set(Object.fromEntries(keys.map(key => [stateKey(key, true), message.data[key]])));
  const changes = Object.fromEntries(keys.map(key => [key, { newValue: message.data[key] }]));
  const tabs = await extensionApi.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => {
    if (!tab.incognito || !tab.url) return false;
    const url = new URL(tab.url);
    return url.origin === page.origin && url.pathname === page.pathname;
  }).map(tab => extensionApi.tabs.sendMessage(tab.id, { type: "search-tabs:private-changed", changes })));
  return {};
}

extensionApi.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== extensionApi.runtime.id) return;
  if (message?.type === "search-tabs:ready" && sender.tab && sender.frameId === 0) {
    const origin = new URL(sender.url).origin;
    siteIsEnabled(origin, Boolean(sender.tab.incognito)).then(enabled => updateBadge(sender.tab.id, enabled && message.active === true)).then(() => respond({ ok: true }));
    return true;
  }
  if (message?.type === "search-tabs:stopped" && sender.tab) {
    updateBadge(sender.tab.id, false).then(() => respond({ ok: true }));
    return true;
  }
  if (message?.type === "search-tabs:status" && sender.tab) {
    const origin = new URL(sender.url).origin;
    const privateMode = Boolean(sender.tab.incognito);
    Promise.all([siteIsEnabled(origin, privateMode), readState("sharePrivateSearches")]).then(async ([enabled, shared]) => {
      if (!enabled) await updateBadge(sender.tab.id, false);
      respond({ enabled, privateMode, sharedSearches: privateMode && shared === true });
    }, () => respond({ enabled: false, privateMode }));
    return true;
  }
  if (message?.type === "search-tabs:private-data" && sender.tab) {
    const request = pendingPrivateChange.then(() => privateData(message, sender));
    pendingPrivateChange = request.catch(() => {});
    request.then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  const senderPage = sender.url?.split(/[?#]/)[0];
  if (!["popup.html", "options.html"].some(file => senderPage === extensionApi.runtime.getURL(file))) return;
  let action;
  if (message?.type === "search-tabs:clear") action = changeSites(disableAndClear);
  else if (message?.type === "search-tabs:share-private") action = changeSites(() => setPrivateSharing(message.enabled));
  else if (message?.type === "search-tabs:site-status") action = siteStatus(message.tabId, message.origin);
  else if (message?.type === "search-tabs:prepare-enable") action = changeSites(() => prepareActivation(message.tabId, message.origin));
  else if (message?.type === "search-tabs:cancel-enable") action = changeSites(async () => {
    const tab = await targetTab(message.tabId, message.origin);
    await cancelActivation(tab.id, message.origin, Boolean(tab.incognito));
  });
  else if (message?.type === "search-tabs:complete-enable") action = changeSites(async () => {
    const tab = await targetTab(message.tabId, message.origin);
    const privateMode = Boolean(tab.incognito);
    if (await siteIsEnabled(message.origin, privateMode)) return;
    const request = (await pendingActivations(privateMode)).find(item => item.tabId === message.tabId && item.origin === message.origin);
    if (request) return completeActivation(request, privateMode);
    const state = await inspectPage(message.tabId);
    return { ok: false, reason: state === "ready" ? "error" : state };
  });
  else if (message?.type === "search-tabs:disable") action = changeSites(async () => {
    const tab = message.tabId === undefined ? null : await targetTab(message.tabId, message.origin);
    return disableSite(message.origin, Boolean(tab?.incognito));
  });
  else if (message?.type === "search-tabs:enable") action = changeSites(async () => {
    const tab = await targetTab(message.tabId, message.origin);
    if (!await extensionApi.permissions.contains({ origins: [sitePattern(message.origin)] })) throw new Error("Site access was not granted.");
    const state = await inspectPage(tab.id);
    if (state !== "ready") return { ok: false, reason: state };
    await enableSite(tab);
  });
  else return;
  action.then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});

async function reconcileSites(migrate = false) {
  const registered = await extensionApi.scripting.getRegisteredContentScripts();
  const stored = await extensionApi.storage.local.get("enabledSites");
  const sites = migrate && !Array.isArray(stored.enabledSites)
    ? [...new Set(registered.filter(script => script.id.startsWith("site-") && script.persistAcrossSessions !== false).flatMap(script => script.matches).map(pattern => pattern.slice(0, -2)))]
    : await enabledSites();
  const allowed = [];
  for (const origin of sites) {
    if (await extensionApi.permissions.contains({ origins: [sitePattern(origin)] })) allowed.push(origin);
  }
  await extensionApi.storage.local.set({ enabledSites: allowed });
  const privateSites = await enabledSites(true);
  const privateAllowed = [];
  for (const origin of privateSites) {
    if (await extensionApi.permissions.contains({ origins: [sitePattern(origin)] })) privateAllowed.push(origin);
  }
  await writeState("enabledSites", privateAllowed, true);
  const expected = [...new Set([...allowed, ...privateAllowed])].flatMap(origin => siteScripts(origin, allowed.includes(origin)));
  const removed = registered.filter(script => script.id.startsWith("site-") && !expected.some(item => item.id === script.id));
  if (removed.length) await extensionApi.scripting.unregisterContentScripts({ ids: removed.map(script => script.id) });
  const missing = expected.filter(script => !registered.some(item => item.id === script.id));
  const existing = expected.filter(script => registered.some(item => item.id === script.id));
  if (missing.length) await extensionApi.scripting.registerContentScripts(missing);
  if (existing.length) await extensionApi.scripting.updateContentScripts(existing);
  await stopTabs(sites.filter(site => !allowed.includes(site)), false);
  await stopTabs(privateSites.filter(site => !privateAllowed.includes(site)), true);
}

extensionApi.runtime.onInstalled.addListener(() => { changeSites(async () => { await closePrivateSession(); await reconcileSites(true); await resumeActivations(); await restorePages(); }).catch(console.error); });
extensionApi.runtime.onStartup.addListener(() => { changeSites(async () => { await closePrivateSession(); await reconcileSites(); await resumeActivations(); await restorePages(); }).catch(console.error); });
extensionApi.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete") refreshPage(tab).catch(console.error);
});
extensionApi.tabs.onActivated.addListener(({ tabId }) => {
  extensionApi.tabs.get(tabId).then(refreshPage).catch(() => {});
});
extensionApi.windows.onRemoved.addListener(() => { changeSites(closePrivateSession).catch(console.error); });
extensionApi.permissions.onAdded.addListener(() => { changeSites(resumeActivations).catch(console.error); });
extensionApi.permissions.onRemoved.addListener(() => { changeSites(reconcileSites).catch(console.error); });
restorePages().catch(console.error);
