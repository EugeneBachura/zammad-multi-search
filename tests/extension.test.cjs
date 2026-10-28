const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createServer } = require("../scripts/demo.cjs");

test("Zammad extension in Chrome", { timeout: 90000 }, async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sitePattern = "http://127.0.0.1/*";
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zammad-search-test-"));
  const extensionDirectory = path.join(temporaryDirectory, "extension");
  await fs.cp(path.join(__dirname, "../extension"), extensionDirectory, { recursive: true });
  const manifestPath = path.join(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.host_permissions = [sitePattern];
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  let context;
  t.after(async () => {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temporaryDirectory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporaryDirectory).startsWith("zammad-search-test-"));
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  context = await chromium.launchPersistentContext(path.join(temporaryDirectory, "profile"), {
    channel: "chromium",
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    viewport: { width: 1440, height: 900 }
  });

  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const documentRequests = [];
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
  });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => { window.originalTaskUpdate = App.TaskManager.update; }, { once: true });
  });
  await page.goto(origin);

  await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
    await enableSite(tab);
  }, origin);

  async function waitUntil(check) {
    const deadline = Date.now() + 5000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error("Expected browser state was not reached");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async function search(query) {
    await page.locator(".global-search-input").fill(query);
    await page.locator(".global-search-input").press("Enter");
    await waitUntil(async () => (await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery))).includes(query));
    await waitUntil(async () => await page.locator(".js-search").inputValue() === query);
  }

  async function editSearch(query) {
    await page.locator(".js-search").fill(query);
    await page.locator(".js-search").press("Enter");
    await waitUntil(async () => (await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery))).includes(query));
    await waitUntil(async () => await page.locator(".js-search").inputValue() === query);
  }

  await t.test("new searches automatically stay open and switch on the same document", async () => {
    await search("state.name:open");
    await search("Knovel / zażółć + 50% #? & привет");
    assert.equal(await page.locator(".zms-tab").count(), 2);
    assert.equal(await page.locator(".zms-save").count(), 0);
    const nativeKeys = await page.locator(".tasks-navigation > a").evaluateAll(tabs => tabs.map(tab => tab.dataset.key));
    assert.deepEqual(nativeKeys, ["Ticket-1109", "Search"]);
    await waitUntil(async () => !await page.locator('[data-key="Search"]').isVisible());

    await page.locator(".zms-tab").first().click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "state.name:open");
    assert.equal(context.pages().length, 1);
    assert.equal(documentRequests.length, 1);

    await page.locator(".zms-tab").nth(1).click({ modifiers: ["Control"] });
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "Knovel / zażółć + 50% #? & привет");
    await page.locator(".zms-tab").first().click({ button: "middle" });
    assert.equal(context.pages().length, 1);
    assert.equal(documentRequests.length, 1);
  });

  await t.test("live input edits the active tab in place and a global search still opens another tab", async () => {
    await page.evaluate(() => { window.editedSearchTab = document.querySelector(".zms-tab.is-active"); });
    await page.locator(".js-search").fill("");
    await page.locator(".js-search").pressSequentially("drukarka", { delay: 35 });
    const queries = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    assert.deepEqual(queries, ["state.name:open", "Knovel / zażółć + 50% #? & привет"]);
    assert.equal(await page.locator('[data-key="Search"]').isVisible(), false);
    await waitUntil(async () => (await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)))[1] === "drukarka");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), [queries[0], "drukarka"]);
    assert.equal(await page.evaluate(() => window.editedSearchTab === document.querySelector(".zms-tab.is-active")), true);
    await editSearch(queries[1]);
    await search("drukarka");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), [...queries, "drukarka"]);
    await page.locator(".zms-tab").first().click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "state.name:open");
    assert.equal(await page.locator(".zms-tab").count(), 3);
  });

  await t.test("search tabs use the native markup, SVG icons and theme styles", async () => {
    const styles = await page.evaluate(() => {
      const native = document.querySelector('[data-key="Search"]');
      const active = document.querySelector(".zms-tab.is-active");
      const properties = ["padding", "height", "fontFamily", "fontSize", "color", "backgroundColor"];
      return {
        native: properties.map(property => getComputedStyle(native)[property]),
        active: properties.map(property => getComputedStyle(active)[property]),
        nativeIcon: native.querySelector(".nav-tab-icon").innerHTML,
        icon: active.querySelector(".nav-tab-icon").innerHTML,
        nativeClose: native.querySelector(".nav-tab-close").innerHTML,
        close: active.querySelector(".zms-close").innerHTML,
        directName: Boolean(active.querySelector(":scope > .nav-tab-name"))
      };
    });
    assert.deepEqual(styles.active, styles.native);
    assert.equal(styles.icon, styles.nativeIcon);
    assert.equal(styles.close, styles.nativeClose);
    assert.equal(styles.directName, true);
  });

  await t.test("tabs survive reload and a full task bar redraw", async () => {
    await page.reload();
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    await page.evaluate(() => {
      const navigation = document.querySelector(".tasks-navigation");
      navigation.querySelectorAll(".zms-tab").forEach(element => element.remove());
      navigation.outerHTML = navigation.outerHTML;
    });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    assert.equal(await page.locator(".zms-save").count(), 0);
  });

  await t.test("ticket navigation keeps saved searches and native ticket clicks", async () => {
    await page.locator('[data-key="Ticket-1109"]').click();
    await waitUntil(async () => await page.locator("#ticket-view").isVisible());
    await waitUntil(async () => await page.locator(".zms-tab.is-active").count() === 0);
    assert.equal(await page.locator(".zms-save").count(), 0);
    await page.locator(".zms-tab").first().click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "state.name:open");
  });

  await t.test("closing the active tab activates a neighbouring search and stays closed after reload", async () => {
    await page.locator(".zms-tab").first().hover();
    await page.locator(".zms-tab").first().locator(".zms-close").click();
    await waitUntil(async () => await page.locator(".zms-tab").count() === 2);
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "Knovel / zażółć + 50% #? & привет");
    await waitUntil(async () => !await page.locator('[data-key="Search"]').isVisible());
    await page.reload();
    await waitUntil(async () => await page.locator(".zms-tab").count() === 2);
  });

  await t.test("logout and another account cannot see the previous account's tabs", async () => {
    await page.evaluate(() => { userId = null; });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
    await page.evaluate(() => { userId = "8"; });
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 1);
    assert.equal(await page.locator(".zms-tab").count(), 0);
    await search("account eight");
    await page.evaluate(() => { userId = "7"; });
    await waitUntil(async () => await page.locator(".zms-tab").first().getAttribute("data-zms-query") === "Knovel / zażółć + 50% #? & привет");
  });

  await t.test("query text is never interpreted as HTML", async () => {
    await search('<img src=x onerror="window.injected=true">');
    assert.equal(await page.locator(".zms-tab img").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
  });

  await t.test("storage failure keeps existing tabs and allows a retry", async () => {
    const previousCount = await page.locator(".zms-tab").count();

    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const originalSet = chrome.storage.local.set;
          chrome.storage.local.set = async (...args) => {
            chrome.storage.local.set = originalSet;
            throw new Error("Storage unavailable");
          };
        }
      });
    }, origin);

    await search("retry storage");
    await waitUntil(async () => (await page.locator(".zms-tab").first().getAttribute("title")).includes("\n"));
    await waitUntil(async () => await page.locator(".zms-tab").count() === previousCount + 1);
    await waitUntil(async () => await worker.evaluate(async key => (await chrome.storage.local.get(key))[key]?.includes("retry storage"), `searches:${origin}/:7`));
  });

  await t.test("a click just after logout cannot reopen a previous account's search", async () => {
    const previousHash = await page.evaluate(() => location.hash);
    const previousCount = await page.locator(".zms-tab").count();
    await page.evaluate(() => {
      userId = null;
      document.querySelector(".zms-tab").click();
    });
    assert.equal(await page.evaluate(() => location.hash), previousHash);
    await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
    await page.evaluate(() => { userId = "7"; });
    await waitUntil(async () => await page.locator(".zms-tab").count() === previousCount);
  });

  await t.test("repeated activation does not duplicate controls or registered scripts", async () => {
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await enableSite(tab);
    }, origin);
    assert.equal(await page.locator(".zms-save").count(), 0);
    assert.equal(await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), 2);
  });

  await t.test("extension stays inactive on other sites", async () => {
    const otherPage = await context.newPage();
    await otherPage.goto(`http://localhost:${server.address().port}`);
    assert.equal(await otherPage.locator(".zms-save, .zms-tab").count(), 0);
    await otherPage.close();
  });

  await t.test("rapid searches through Zammad state updates are kept even with an unchanged hash", async () => {
    await page.evaluate(() => {
      location.hash = "#search";
      App.TaskManager.update("Search", { state: { query: "native query A" } });
      App.TaskManager.update("Search", { state: { query: "native query B" } });
      renderRoute();
    });
    await waitUntil(async () => (await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery))).includes("native query B"));
    const queries = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    assert.ok(queries.includes("native query A"));
    assert.ok(queries.includes("native query B"));
    await waitUntil(async () => await worker.evaluate(async key => {
      const queries = (await chrome.storage.local.get(key))[key];
      return queries?.includes("native query A") && queries.includes("native query B");
    }, `searches:${origin}/:7`));
  });

  await t.test("closing an inactive tab preserves the current result and does not reopen it", async () => {
    const hash = await page.evaluate(() => location.hash);
    const tab = page.locator('.zms-tab[data-zms-query="native query A"]');
    await tab.hover();
    await tab.locator(".zms-close").click();
    await waitUntil(async () => await tab.count() === 0);
    await page.evaluate(() => document.dispatchEvent(new Event("zammad-multi-search:request")));
    assert.equal(await page.evaluate(() => location.hash), hash);
    assert.equal(await tab.count(), 0);
    await page.locator('.zms-tab[data-zms-query="native query B"]').focus();
    await page.locator('.zms-tab[data-zms-query="native query B"]').press("Enter");
    assert.equal(context.pages().length, 1);
  });

  await t.test("leaving live input for another search preserves both queries without Enter", async () => {
    await page.locator(".js-search").fill("");
    await page.locator(".js-search").pressSequentially("typed before navigation", { delay: 5 });
    assert.equal(await page.locator(".js-search").inputValue(), "typed before navigation");
    await search("Knovel");
    const queries = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    assert.ok(queries.includes("typed before navigation"), JSON.stringify(queries));
    assert.equal(queries.filter(query => query === "Knovel").length, 1);
  });

  await t.test("Enter replaces the selected search without moving its tab and survives reload", async () => {
    await search("editable search");
    const before = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    const index = before.indexOf("editable search");
    await page.evaluate(() => { window.editedSearchTab = document.querySelector(".zms-tab.is-active"); });
    await editSearch("updated search");
    const expected = before.map(query => query === "editable search" ? "updated search" : query);
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), expected);
    assert.equal(await page.evaluate(() => window.editedSearchTab === document.querySelector(".zms-tab.is-active")), true);
    await waitUntil(async () => await worker.evaluate(async key => {
      const queries = (await chrome.storage.local.get(key))[key];
      return queries?.[queries.length - 1] === "updated search" && !queries.includes("editable search");
    }, `searches:${origin}/:7`));
    await page.reload();
    await waitUntil(async () => await page.locator(".zms-tab").count() === expected.length);
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), expected);
    assert.equal(await page.locator(".zms-tab").nth(index).getAttribute("aria-current"), "page");
  });

  await t.test("clearing the input and applying filters updates the same search", async () => {
    await search("clear and reuse");
    const before = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    await page.locator(".js-search").fill("");
    await page.locator(".js-search").press("Backspace");
    await waitUntil(async () => await page.evaluate(() => App.TaskManager.get("Search").state.query === ""));
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    assert.equal(await dialog.locator(".zms-builder-base").inputValue(), "");
    await dialog.locator('.zms-builder-field[data-field="tags"]').click();
    await dialog.locator('.zms-builder-condition[data-field="tags"] input').fill("feedback");
    await dialog.locator(".zms-builder-apply").click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === 'tags:"feedback"');
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), before.map(query => query === "clear and reuse" ? 'tags:"feedback"' : query));
  });

  await t.test("native suggested filters edit the current tab", async () => {
    await search("suggested filter source");
    const before = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    await page.locator('.examples [data-query="state.name:open"]').click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "state.name:open");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), before.filter(query => query !== "state.name:open").map(query => query === "suggested filter source" ? "state.name:open" : query));
  });

  await t.test("editing to an already open query keeps one tab in the edited position", async () => {
    await search("collision first");
    await search("collision second");
    await page.locator('.zms-tab[data-zms-query="collision first"]').click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "collision first");
    const before = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    await editSearch("collision second");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), before.filter(query => query !== "collision second").map(query => query === "collision first" ? "collision second" : query));
  });

  await t.test("builder uses the application modal template and theme styles", async () => {
    await search("native controls");
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    assert.equal(await dialog.locator('[data-native-modal-template="true"]').count(), 1);
    assert.equal(await dialog.locator(".zms-builder-query").isVisible(), true);
    assert.equal(await dialog.locator("details, summary").count(), 0);
    const theme = await page.evaluate(() => {
      const properties = ["color", "backgroundColor", "borderColor", "borderRadius", "fontFamily", "fontSize", "padding"];
      const styles = selector => properties.map(property => getComputedStyle(document.querySelector(selector))[property]);
      return {
        launch: styles(".zms-builder-launch"), nativeLaunch: styles('[data-reference="action"]'),
        apply: styles(".zms-builder-apply"), nativeApply: styles('[data-reference="primary"]'),
        input: styles(".zms-builder-base"), nativeInput: styles('[data-reference="control"]')
      };
    });
    assert.deepEqual(theme.launch, theme.nativeLaunch);
    assert.deepEqual(theme.apply, theme.nativeApply);
    assert.deepEqual(theme.input, theme.nativeInput);

    const originalTheme = await page.evaluate(() => {
      const root = document.documentElement;
      const original = root.getAttribute("style") || "";
      root.style.setProperty("--button-primary-background", "#6842a1");
      root.style.setProperty("--background-secondary", "#20242b");
      root.style.setProperty("--text-normal", "#eceef2");
      return original;
    });
    const changedTheme = await page.evaluate(() => ({
      button: getComputedStyle(document.querySelector(".zms-builder-apply")).backgroundColor,
      nativeButton: getComputedStyle(document.querySelector('[data-reference="primary"]')).backgroundColor,
      surface: getComputedStyle(document.querySelector(".zms-builder .modal-content")).backgroundColor,
      nativeSurface: getComputedStyle(document.querySelector('[data-reference="content"]')).backgroundColor
    }));
    assert.equal(changedTheme.button, changedTheme.nativeButton);
    assert.equal(changedTheme.surface, changedTheme.nativeSurface);
    await page.evaluate(original => document.documentElement.setAttribute("style", original), originalTheme);
    await dialog.locator(".zms-builder-cancel").click();
  });

  await t.test("compact header leaves room for the catalog after adding a group", async () => {
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await dialog.locator(".zms-builder-add-group").click();
    const layout = await dialog.evaluate(dialog => {
      const catalog = dialog.querySelector(".zms-builder-catalog");
      return {
        header: dialog.querySelector(".zms-builder-header").getBoundingClientRect().height,
        catalogHeight: catalog.clientHeight, contentHeight: catalog.scrollHeight,
        labelled: Boolean(document.getElementById(dialog.getAttribute("aria-labelledby"))?.textContent)
      };
    });
    assert.ok(layout.header <= 34);
    assert.ok(layout.contentHeight <= layout.catalogHeight + 1, JSON.stringify(layout));
    assert.equal(layout.labelled, true);
    assert.equal(await dialog.locator(".zms-builder-dismiss").isVisible(), true);
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.ok(await dialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.locator(".zms-builder-cancel").click();
  });

  await t.test("builder dimensions stay fixed while query and condition content changes", async () => {
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    const initial = await dialog.boundingBox();
    await dialog.locator(".zms-builder-base").fill("A".repeat(2500));
    await dialog.locator('.zms-builder-field[data-field="created"]').click();
    await dialog.locator('.zms-builder-condition[data-field="created"] select').selectOption("between");
    await dialog.locator('.zms-builder-field[data-field="state"]').click();
    await dialog.locator('.zms-builder-choice[data-value="open"]').click();
    const changed = await dialog.boundingBox();
    assert.equal(changed.width, initial.width);
    assert.equal(changed.height, initial.height);
    assert.equal(await dialog.locator(".zms-builder-query").isVisible(), true);
    await page.setViewportSize({ width: 640, height: 800 });
    const narrow = await dialog.boundingBox();
    assert.ok(narrow.width <= 608);
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal((await dialog.boundingBox()).width, initial.width);
    await dialog.locator(".zms-builder-cancel").click();
  });

  await t.test("native templates cannot insert executable markup or remote resources", async () => {
    await page.evaluate(() => {
      window.savedModalView = App.view;
      App.view = name => {
        const render = window.savedModalView(name);
        return data => render(data).replace('<div class="modal-header">', '<div class="modal-header"><script>window.templateExecuted = true</script><img src="https://example.invalid/pixel" onerror="window.templateExecuted = true"><svg onload="window.templateExecuted = true"><use href="javascript:alert(1)"></use><foreignObject><iframe></iframe></foreignObject></svg>');
      };
    });
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    assert.equal(await dialog.locator("script, img, iframe, foreignObject").count(), 0);
    assert.equal(await dialog.locator("[onload], [onerror], [href^='javascript:']").count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.templateExecuted)), false);
    await dialog.locator(".zms-builder-cancel").click();
    await page.evaluate(() => { App.view = window.savedModalView; delete window.savedModalView; });
  });

  await t.test("builder keeps native component classes when the modal view is unavailable", async () => {
    await page.evaluate(() => { window.savedModalView = App.view; App.view = undefined; });
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    assert.equal(await dialog.locator(".modal-content .modal-header .modal-title").count(), 1);
    assert.equal(await dialog.locator(".modal-footer .btn--primary").isVisible(), true);
    await dialog.locator(".zms-builder-dismiss").focus();
    await dialog.locator(".zms-builder-dismiss").press("Enter");
    assert.equal(await dialog.count(), 0);
    await page.evaluate(() => { App.view = window.savedModalView; delete window.savedModalView; });
  });

  await t.test("group suggestions use the native dropdown theme and centered select arrows", async t => {
    t.after(async () => {
      const cancel = page.locator(".zms-builder-cancel");
      if (await cancel.count()) await cancel.click();
    });
    await search("group suggestions");
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await page.evaluate(() => document.dispatchEvent(new Event("zammad-multi-search:request")));
    await dialog.locator('.zms-builder-field[data-field="group"]').click();
    const group = dialog.locator('.zms-builder-condition[data-field="group"]');
    const input = group.locator('input[role="combobox"]');
    await input.fill("CUI");
    assert.equal(await group.locator("datalist, input[list]").count(), 0);
    assert.equal(await group.locator('[role="option"]').count(), 2);
    assert.equal(await group.locator(".dropdown-menu").isVisible(), true);
    assert.equal(await group.locator('.icon-arrow-down[data-native-select-icon="true"]').count(), 2);
    const geometry = await group.evaluate(row => {
      return [...row.querySelectorAll(".controls--select")].map(wrapper => {
        const field = wrapper.querySelector(".form-control").getBoundingClientRect();
        const arrow = wrapper.querySelector(".icon-arrow-down").getBoundingClientRect();
        return Math.abs(arrow.top + arrow.height / 2 - field.top - field.height / 2);
      });
    });
    assert.ok(geometry.every(distance => distance <= 1));

    const originalTheme = await page.evaluate(() => {
      const root = document.documentElement;
      const original = root.getAttribute("style") || "";
      root.style.setProperty("--background-tertiary", "#17191e");
      root.style.setProperty("--background-secondary", "#2b2d33");
      root.style.setProperty("--text-normal", "#eceef2");
      return original;
    });
    const theme = await group.evaluate(row => ({
      popup: getComputedStyle(row.querySelector(".dropdown-menu")).backgroundColor,
      native: getComputedStyle(document.querySelector('[data-reference="dropdown"]')).backgroundColor,
      text: getComputedStyle(row.querySelector(".dropdown-menu")).color,
      nativeText: getComputedStyle(document.querySelector('[data-reference="dropdown"]')).color
    }));
    assert.equal(theme.popup, theme.native);
    assert.equal(theme.text, theme.nativeText);
    await fs.mkdir(path.join(__dirname, "../test-results"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../test-results/group-suggestions-dark.png"), fullPage: true });

    await input.press("ArrowUp");
    assert.equal(await group.locator('[role="option"][aria-selected="true"]').textContent(), "CUI - Serwis");
    await input.press("ArrowDown");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "CUI");
    assert.equal(await input.getAttribute("aria-expanded"), "false");
    assert.match(await dialog.locator(".zms-builder-query").inputValue(), /group\.name:"CUI"/);
    await page.evaluate(original => document.documentElement.setAttribute("style", original), originalTheme);
    await dialog.locator(".zms-builder-cancel").click();
  });

  await t.test("group suggestions support mouse selection, free text and Escape", async t => {
    t.after(async () => {
      const cancel = page.locator(".zms-builder-cancel");
      if (await cancel.count()) await cancel.click();
    });
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await dialog.locator('.zms-builder-field[data-field="group"]').click();
    const group = dialog.locator('.zms-builder-condition[data-field="group"]');
    const input = group.locator('input[role="combobox"]');
    await input.fill("help");
    await group.getByRole("option", { name: "IT Helpdesk", exact: true }).click();
    assert.equal(await input.inputValue(), "IT Helpdesk");
    assert.equal(await input.getAttribute("aria-expanded"), "false");
    await input.fill("custom group");
    assert.equal(await group.locator('[role="option"]').count(), 0);
    assert.equal(await dialog.locator(".zms-builder-apply").isEnabled(), true);
    await input.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await input.getAttribute("aria-expanded"), "false");
    await input.press("Escape");
    assert.equal(await dialog.count(), 0);
  });

  await t.test("builder combines instance-specific choices and searches in this document", async () => {
    await search("Knovel OR Aleph");
    const before = await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    const previousRequests = documentRequests.length;
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await page.locator('.zms-builder-field[data-field="state"]').click();
    await dialog.locator('.zms-builder-choice[data-value="open"]').click();
    await dialog.locator('.zms-builder-choice[data-value="needs triage"]').click();
    assert.equal(await dialog.getByRole("button", { name: "Do weryfikacji", exact: true }).count(), 1);
    await page.locator('.zms-builder-field[data-field="priority"]').click();
    await dialog.locator('.zms-builder-choice[data-value="4 urgent"]').click();
    await page.locator('.zms-builder-field[data-field="created"]').click();
    const query = '(Knovel OR Aleph) AND (state.name:("open" OR "needs triage")) AND (priority.name:"4 urgent") AND (created_at:>now-7d)';
    assert.equal(await dialog.locator(".zms-builder-query").inputValue(), query);
    await dialog.locator(".zms-builder-apply").click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === query);
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), before.map(value => value === "Knovel OR Aleph" ? query : value));
    assert.equal(context.pages().length, 1);
    assert.equal(documentRequests.length, previousRequests);

    await waitUntil(async () => (await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery))).includes(query));
    await page.locator(".zms-builder-launch").click();
    assert.equal(await dialog.locator(".zms-builder-condition").count(), 3);
    assert.equal(await dialog.locator(".zms-builder-base").inputValue(), "Knovel OR Aleph");
    await dialog.locator('[data-field="priority"] .zms-builder-remove').click();
    assert.equal(await dialog.locator(".zms-builder-condition").count(), 2);
    await dialog.locator(".zms-builder-cancel").click();
    assert.equal(await page.locator(".js-search").inputValue(), query);
  });

  await t.test("builder validates dates and counts and supports OR and exclusion", async () => {
    await search("drukarka OR skaner");
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await dialog.locator('.zms-builder-field[data-field="customer"]').click();
    const customer = dialog.locator('.zms-builder-condition[data-field="customer"]');
    await customer.locator("select").selectOption("isNot");
    await customer.locator("input").fill('a+b"test\\@example.org');

    await dialog.locator('.zms-builder-field[data-field="created"]').click();
    const created = dialog.locator('.zms-builder-condition[data-field="created"]');
    await created.locator("select").selectOption("between");
    await created.locator("input").first().fill("2026-10-10");
    await created.locator("input").nth(1).fill("2026-10-01");
    assert.equal(await dialog.locator(".zms-builder-apply").isDisabled(), true);
    assert.equal(await created.locator(".zms-builder-error").isVisible(), true);
    await created.locator("input").nth(1).fill("2026-10-27");

    await dialog.locator('.zms-builder-field[data-field="articles"]').click();
    const articles = dialog.locator('.zms-builder-condition[data-field="articles"]');
    await articles.locator("input").fill("1.5");
    assert.equal(await dialog.locator(".zms-builder-apply").isDisabled(), true);
    await articles.locator("input").fill("5");
    await articles.locator("select").selectOption("atLeast");
    await dialog.locator('[data-join="any"]').click();
    assert.match(await dialog.locator('[data-join="any"]').textContent(), /OR/);
    assert.match(await dialog.locator(".zms-builder-join-help").textContent(), /LUB/);
    assert.equal(await dialog.locator('[data-join="any"]').getAttribute("aria-pressed"), "true");
    const query = String.raw`(drukarka OR skaner) OR (NOT (customer.email:"a+b\"test\\@example.org")) OR (created_at:[2026-10-10 TO 2026-10-27]) OR (article_count:[5 TO *])`;
    assert.equal(await dialog.locator(".zms-builder-query").inputValue(), query);
    await dialog.locator(".zms-builder-apply").click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === query);
  });

  await t.test("independent groups combine AND, OR and NOT and reopen as editable groups", async () => {
    await search("grouped search");
    const previousCount = await page.locator(".zms-tab").count();
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await dialog.locator(".zms-builder-base").fill("");
    await dialog.locator(".zms-builder-add-group").click();
    const first = dialog.locator(".zms-builder-group").first();
    await first.locator('[data-join="any"]').click();
    for (const value of ["IT", "Support"]) {
      await dialog.locator('.zms-builder-field[data-field="group"]').click();
      await first.locator('.zms-builder-condition[data-field="group"] input').last().fill(value);
    }
    await dialog.locator(".zms-builder-add-group").click();
    const second = dialog.locator(".zms-builder-group").nth(1);
    await second.locator('[data-join="any"]').click();
    await dialog.locator('.zms-builder-field[data-field="tags"]').click();
    await second.locator('[data-field="tags"] input').fill("spam");
    await dialog.locator('.zms-builder-field[data-field="body"]').click();
    await second.locator('[data-field="body"] input').fill("bounce");
    await second.locator(".zms-builder-negate").click();
    await dialog.locator(".zms-builder-target select").selectOption("root");
    await dialog.locator('.zms-builder-field[data-field="created"]').click();
    const expected = '((group.name:"IT") OR (group.name:"Support")) AND (NOT ((tags:"spam") OR (article.body:"bounce"))) AND (created_at:>now-7d)';
    assert.equal(await dialog.locator(".zms-builder-query").inputValue(), expected);
    await dialog.locator(".zms-builder-apply").click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === expected);
    assert.equal(await page.locator(".zms-tab").count(), previousCount);
    await page.locator(".zms-builder-launch").click();
    assert.equal(await dialog.locator(".zms-builder-group").count(), 2);
    assert.equal(await dialog.locator(".zms-builder-query").inputValue(), expected);
    await dialog.locator(".zms-builder-cancel").click();
  });

  await t.test("conditions can be regrouped and numeric TO ranges work inside nested groups", async () => {
    const original = await page.locator(".js-search").inputValue();
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    const first = dialog.locator(".zms-builder-group").first();
    const firstId = await first.getAttribute("data-group-id");
    await dialog.locator('[data-field="created"] .zms-builder-move').selectOption(firstId);
    assert.equal(await first.locator('[data-field="created"]').count(), 1);
    await first.locator(".zms-builder-ungroup").click();
    assert.equal(await dialog.locator(".zms-builder-group").count(), 1);
    const excluded = dialog.locator(".zms-builder-group");
    assert.equal(await excluded.locator(".zms-builder-ungroup").isDisabled(), true);
    await excluded.locator(".zms-builder-negate").click();
    await excluded.locator(".zms-builder-ungroup").click();
    assert.equal(await dialog.locator(".zms-builder-group").count(), 0);
    await dialog.locator(".zms-builder-add-group").click();
    assert.equal(await dialog.locator(".zms-builder-apply").isDisabled(), true);
    await dialog.locator(".zms-builder-add-subgroup").click();
    await dialog.locator('.zms-builder-field[data-field="articles"]').click();
    const articles = dialog.locator('.zms-builder-condition[data-field="articles"]');
    await articles.locator(".zms-builder-operator").selectOption("between");
    await articles.locator("input").first().fill("0");
    await articles.locator("input").nth(1).fill("10");
    await articles.locator(".zms-builder-negate").click();
    assert.match(await dialog.locator(".zms-builder-query").inputValue(), /NOT \(article_count:\[0 TO 10\]\)/);
    assert.equal(await dialog.locator(".zms-builder-apply").isDisabled(), false);
    await dialog.locator(".zms-builder-cancel").click();
    assert.equal(await page.locator(".js-search").inputValue(), original);
  });

  await t.test("catalog filtering and Escape leave the current search untouched", async () => {
    const query = await page.locator(".js-search").inputValue();
    await page.evaluate(() => {
      window.nativeKeyups = 0;
      document.addEventListener("keyup", () => window.nativeKeyups++);
    });
    await page.locator(".zms-builder-launch").click();
    const dialog = page.locator("dialog.zms-builder");
    await dialog.locator(".zms-builder-find").press("a");
    assert.equal(await page.evaluate(() => window.nativeKeyups), 0);
    await dialog.locator(".zms-builder-find").fill("załącz");
    assert.equal(await dialog.locator(".zms-builder-field").count(), 1);
    assert.equal(await dialog.locator(".zms-builder-field").getAttribute("data-field"), "attachment");
    await dialog.locator(".zms-builder-find").press("Escape");
    assert.equal(await page.locator("dialog.zms-builder").count(), 0);
    assert.equal(await page.locator(".js-search").inputValue(), query);
  });

  await t.test("a builder opened before logout cannot run a search in another account", async () => {
    const hash = await page.evaluate(() => location.hash);
    await page.locator(".zms-builder-launch").click();
    await page.evaluate(() => {
      userId = null;
      document.querySelector(".zms-builder-apply").click();
    });
    assert.equal(await page.evaluate(() => location.hash), hash);
    await waitUntil(async () => await page.locator(".zms-builder-launch, dialog.zms-builder").count() === 0);
    await page.evaluate(() => { userId = "7"; });
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 1);
  });

  await t.test("searches saved by the previous version are restored with automatic searches", async () => {
    await worker.evaluate(async key => chrome.storage.local.set({ [key]: ["previously saved A", "previously saved B"] }), `searches:${origin}/:10`);
    await page.evaluate(() => {
      userId = "10";
      searchState = { query: "" };
      location.hash = "#search";
      renderRoute();
    });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 2);
    await search("automatic search C");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), ["previously saved A", "previously saved B", "automatic search C"]);
    assert.equal(await page.locator(".zms-save").count(), 0);
  });

  await t.test("closing the last search closes the native task and returns to the ticket", async () => {
    await page.evaluate(() => {
      userId = "99";
      searchState = { query: "" };
      location.hash = "#search";
      renderRoute();
    });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
    await search("only search");
    await page.locator(".zms-tab").focus();
    await page.locator(".zms-close").focus();
    await page.locator(".zms-close").press("Enter");
    await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
    await waitUntil(async () => await page.locator("#ticket-view").isVisible());
    assert.equal(await page.locator('[data-key="Search"]').count(), 0);
    await page.evaluate(() => document.dispatchEvent(new Event("zammad-multi-search:request")));
    assert.equal(await page.locator(".zms-tab").count(), 0);
  });

  await page.evaluate(() => { userId = "9"; location.hash = "#search"; });
  await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
  await waitUntil(async () => await page.locator(".js-search").isVisible());
  await search("state.name:open");
  await search("Knovel");
  await search("drukarka");
  await fs.mkdir(path.join(__dirname, "../test-results"), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, "../test-results/search-tabs.png"), fullPage: true });
  await page.locator(".zms-builder-launch").click();
  await page.locator(".zms-builder-base").fill("Knovel");
  await page.locator('.zms-builder-field[data-field="state"]').click();
  await page.locator('.zms-builder-choice[data-value="new"]').click();
  await page.locator('.zms-builder-choice[data-value="open"]').click();
  await page.locator('.zms-builder-field[data-field="created"]').click();
  await page.locator('.zms-builder-field[data-field="group"]').click();
  await page.locator('.zms-builder-condition[data-field="group"] input').fill("IT Helpdesk");
  await page.screenshot({ path: path.join(__dirname, "../test-results/search-builder.png"), fullPage: true });
  await page.locator(".zms-builder-cancel").click();

  await t.test("toolbar panel enables only the chosen compatible site", async () => {
    const popup = await context.newPage();
    await popup.addInitScript(origin => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = () => query({ url: `${origin}/*` });
      const request = chrome.permissions.request.bind(chrome.permissions);
      chrome.permissions.request = permissions => {
        window.requestedOrigins = permissions.origins;
        return request(permissions);
      };
    }, origin);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await waitUntil(async () => await popup.locator("#enable").isEnabled());
    assert.equal(await popup.locator("#site").textContent(), origin);
    assert.equal(await popup.locator("#enable").textContent(), await popup.evaluate(() => messages.disable));
    await popup.locator("#enable").click();
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.enable));
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch").count(), 0);
    assert.equal(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).some(key => key.startsWith("searches:"))), true);
    await page.reload();
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch").count(), 0);
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    await popup.locator("#enable").click();
    await waitUntil(async () => await popup.locator("#status").textContent() === await popup.evaluate(() => messages.success));
    assert.equal(await popup.evaluate(() => window.requestedOrigins), undefined);
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 1);
    assert.equal(await page.locator(".zms-builder-launch").count(), 1);
    await popup.close();
  });

  await t.test("popup explains sign-in and loading and updates when the workspace becomes ready", async () => {
    const popup = await context.newPage();
    await popup.addInitScript(origin => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = () => query({ url: `${origin}/*` });
    }, origin);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await waitUntil(async () => await popup.locator("#enable").isEnabled());
    await popup.locator("#enable").click();
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.enable));
    await page.evaluate(() => { userId = null; });
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.signInButton));
    assert.equal(await popup.locator("#enable").isDisabled(), true);
    assert.equal(await popup.locator("#status").textContent(), await popup.evaluate(() => messages.signIn));
    await page.evaluate(() => {
      userId = "7";
      window.detachedNavigation = document.querySelector(".tasks-navigation");
      window.detachedNavigation.remove();
    });
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.loadingButton));
    assert.equal(await popup.locator("#enable").isDisabled(), true);
    await page.evaluate(() => { document.body.append(window.detachedNavigation); delete window.detachedNavigation; });
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.enable));
    await popup.locator("#enable").click();
    await waitUntil(async () => await popup.locator("#status").textContent() === await popup.evaluate(() => messages.success));
    await popup.close();
  });

  await t.test("missing site access is explained and declining it cancels activation", async () => {
    const otherOrigin = `http://localhost:${server.address().port}`;
    const otherPage = await context.newPage();
    await otherPage.goto(otherOrigin);
    const popup = await context.newPage();
    await popup.addInitScript(otherOrigin => {
      chrome.tabs.query = async () => [{ id: 100, url: otherOrigin }];
      window.activationMessages = [];
      chrome.runtime.sendMessage = async message => {
        window.activationMessages.push(message.type);
        return message.type === "search-tabs:site-status"
          ? { ok: true, enabled: false, hasAccess: false, pageState: "unknown" }
          : { ok: true };
      };
      chrome.permissions.request = async permissions => { window.requestedOrigins = permissions.origins; return false; };
    }, otherOrigin);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await waitUntil(async () => await popup.locator("#enable").textContent() === await popup.evaluate(() => messages.allow));
    assert.equal(await popup.locator("#status").textContent(), await popup.evaluate(() => messages.allowCheckHelp));
    await popup.locator("#enable").click();
    await waitUntil(async () => await popup.locator("#status").textContent() === await popup.evaluate(() => messages.denied));
    assert.deepEqual(await popup.evaluate(() => window.requestedOrigins), ["http://localhost/*"]);
    assert.ok((await popup.evaluate(() => window.activationMessages)).includes("search-tabs:prepare-enable"));
    assert.ok((await popup.evaluate(() => window.activationMessages)).includes("search-tabs:cancel-enable"));
    assert.equal(await otherPage.locator(".zms-tab, .zms-builder-launch").count(), 0);
    await popup.close();
    await otherPage.close();
  });

  await t.test("settings remove saved data, detach controls and allow activation again", async () => {
    // The harness grants required host access, which Chrome cannot revoke.
    await worker.evaluate(() => {
      chrome.permissions.remove = async ({ origins }) => {
        globalThis.removedOrigins = origins;
        return true;
      };
    });
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
    await waitUntil(async () => (await settings.locator("#sites").textContent()).includes(origin));
    assert.match(await settings.locator("#saved-count").textContent(), /: [1-9]\d*$/);
    await settings.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async message => {
        window.clearReply = await send(message);
        return window.clearReply;
      };
    });
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const set = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.set = data => {
          chrome.storage.local.set = set;
          return new Promise((resolve, reject) => { globalThis.releasePendingSave = () => set(data).then(resolve, reject); });
        };
      } });
    }, origin);
    await search("write still pending during clear");
    settings.once("dialog", dialog => dialog.accept());
    await settings.locator("#clear-data").click();
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 0);
    assert.equal(await settings.evaluate(() => window.clearReply), undefined);
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.releasePendingSave() });
    }, origin);
    await waitUntil(async () => await settings.evaluate(() => window.clearReply !== undefined));
    assert.deepEqual(await settings.evaluate(() => window.clearReply), { ok: true, accessRemoved: true });
    await waitUntil(async () => await settings.locator("#status").textContent() === await settings.evaluate(() => messages.removed));
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), { enabledSites: [] });
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    assert.deepEqual(await worker.evaluate(() => globalThis.removedOrigins), [sitePattern]);
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch, .zms-native-hidden").count(), 0);
    assert.equal(await page.evaluate(() => App.TaskManager.update === window.originalTaskUpdate), true);
    await settings.close();
    await worker.evaluate(async origin => { await chrome.scripting.registerContentScripts(siteScripts(origin)); }, origin);
    await page.reload();
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch").count(), 0);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), { enabledSites: [] });
    assert.equal(await page.evaluate(() => window.zammadMultiSearchBridge), false);
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await enableSite(tab);
    }, origin);
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 1);
    await search("search after clearing data");
    assert.equal(await page.locator('.zms-tab[data-zms-query="search after clearing data"]').count(), 1);
  });
  await t.test("registered scripts can be restored after an extension update", async () => {
    await worker.evaluate(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      await chrome.scripting.unregisterContentScripts({ ids: scripts.map(script => script.id) });
      await reconcileSites();
    });
    await page.reload();
    await waitUntil(async () => await page.locator(".zms-builder-launch").count() === 1);
    assert.equal(await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), 2);
  });

  await t.test("revoking site access stops an already running page and removes persistent activation", async () => {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        globalThis.savedRequestFrame = requestAnimationFrame;
        globalThis.requestAnimationFrame = callback => { globalThis.pendingRenderFrame = callback; return 1; };
        document.body.append(document.createElement("span"));
      } });
    }, origin);
    await worker.evaluate(async () => {
      const contains = chrome.permissions.contains;
      chrome.permissions.contains = async () => false;
      try { await reconcileSites(); } finally { chrome.permissions.contains = contains; }
    });
    const pending = await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        globalThis.requestAnimationFrame = globalThis.savedRequestFrame;
        const pending = Boolean(globalThis.pendingRenderFrame);
        globalThis.pendingRenderFrame?.(0);
        return pending;
      } });
      return result.result;
    }, origin);
    assert.equal(pending, true);
    await waitUntil(async () => await page.locator(".zms-tab, .zms-builder-launch").count() === 0);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("enabledSites")), { enabledSites: [] });
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    await page.reload();
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch").count(), 0);
  });
  await t.test("expired activation requests cannot enable a site after permission is available", async () => {
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await chrome.storage.local.set({ pendingActivations: [{ tabId: tab.id, origin, requestedAt: Date.now() - 10 * 60 * 1000 }] });
      await resumeActivations();
    }, origin);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("enabledSites")), { enabledSites: [] });
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("pendingActivations")).pendingActivations), undefined);
    assert.equal(await page.locator(".zms-tab, .zms-builder-launch").count(), 0);
  });
  await t.test("custom tab names survive reload, query edits and duplicate queries", async () => {
    await worker.evaluate(() => disableAndClear());
    await page.goto(origin);
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await enableSite(tab);
    }, origin);
    await search("state.name:open");
    await search("printer");
    await search("backlog");
    const first = page.locator('.zms-tab[data-zms-query="state.name:open"]');
    await first.hover();
    const pencilBounds = await first.locator(".zms-rename").boundingBox();
    const closeBounds = await first.locator(".zms-close").boundingBox();
    assert.ok(pencilBounds.x + pencilBounds.width <= closeBounds.x + 0.5);
    assert.ok(closeBounds.x - (pencilBounds.x + pencilBounds.width) <= 8.5);
    const pencilAlignment = await first.locator(".zms-rename").evaluate(button => {
      const circle = button.querySelector(".nav-tab-close-inner").getBoundingClientRect();
      const svg = button.querySelector("svg").getBoundingClientRect();
      return { x: Math.abs(circle.x + circle.width / 2 - svg.x - svg.width / 2), y: Math.abs(circle.y + circle.height / 2 - svg.y - svg.height / 2) };
    });
    assert.ok(pencilAlignment.x < 0.6 && pencilAlignment.y < 0.6);
    await page.screenshot({ path: path.join(__dirname, "../test-results/search-tab-actions.png") });
    await first.locator(".zms-rename").click();
    await page.locator(".zms-name-editor").fill("Open tickets");
    await page.locator(".zms-name-editor").press("Enter");
    assert.equal(await first.locator(".nav-tab-name").textContent(), "Open tickets");
    assert.equal(await page.locator(".js-search").inputValue(), "backlog");
    await waitUntil(async () => (await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], `searchSettings:${origin}/:7`))?.names["state.name:open"] === "Open tickets");
    await page.reload();
    await waitUntil(async () => await first.locator(".nav-tab-name").textContent() === "Open tickets");
    await first.click();
    await waitUntil(async () => await page.locator(".js-search").inputValue() === "state.name:open");
    await editSearch("state.name:pending");
    assert.equal(await page.locator(".zms-tab.is-active .nav-tab-name").textContent(), "Open tickets");
    await editSearch("printer");
    assert.equal(await page.locator(".zms-tab").count(), 2);
    assert.equal(await page.locator(".zms-tab.is-active .nav-tab-name").textContent(), "Open tickets");
    const backlog = page.locator('.zms-tab[data-zms-query="backlog"]');
    await backlog.hover();
    await backlog.locator(".zms-rename").click();
    await page.locator(".zms-name-editor").fill("Not saved");
    await page.locator(".zms-name-editor").press("Escape");
    assert.equal(await backlog.locator(".nav-tab-name").textContent(), "backlog");
    await backlog.locator(".zms-rename").click();
    const htmlName = '<img src=x onerror="window.injectedName=true">';
    await page.locator(".zms-name-editor").fill(htmlName);
    await page.locator(".global-search-input").click();
    assert.equal(await backlog.locator(".nav-tab-name").textContent(), htmlName);
    assert.equal(await backlog.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => window.injectedName), undefined);
    await backlog.hover();
    await backlog.locator(".zms-rename").click();
    await page.locator(".zms-name-editor").fill("");
    await page.locator(".zms-name-editor").press("Enter");
    assert.equal(await backlog.locator(".nav-tab-name").textContent(), "backlog");
  });

  await t.test("search tabs can be dragged around native tickets and keep their order after redraw", async () => {
    await search("triage");
    const triage = page.locator('.zms-tab[data-zms-query="triage"]');
    const source = await triage.boundingBox();
    const ticket = await page.locator('[data-key="Ticket-1109"]').boundingBox();
    await page.mouse.move(source.x + 45, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(ticket.x + 45, ticket.y + 3, { steps: 12 });
    assert.equal(await page.locator(".zms-placeholder").count(), 1);
    assert.equal(await triage.evaluate(tab => getComputedStyle(tab).opacity), "0.6");
    await page.screenshot({ path: path.join(__dirname, "../test-results/search-tab-drag.png") });
    await page.mouse.up();
    const queries = () => page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery));
    await waitUntil(async () => (await queries())[0] === "triage");
    assert.equal(await page.locator(".js-search").inputValue(), "triage");
    await waitUntil(async () => (await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], `searchSettings:${origin}/:7`))?.anchors.triage === "Ticket-1109");
    await page.reload();
    await waitUntil(async () => (await queries()).length === 3);
    assert.deepEqual(await queries(), ["triage", "printer", "backlog"]);
    assert.equal(await page.locator(".tasks-navigation > .nav-tab").first().getAttribute("data-zms-query"), "triage");
    await page.evaluate(() => {
      const navigation = document.querySelector(".tasks-navigation");
      navigation.replaceChildren(...navigation.querySelectorAll(":scope > a"));
    });
    await waitUntil(async () => (await queries()).length === 3);
    assert.deepEqual(await queries(), ["triage", "printer", "backlog"]);
    assert.deepEqual(await page.locator(".tasks-navigation > a").evaluateAll(tabs => tabs.map(tab => tab.dataset.key)), ["Ticket-1109", "Search"]);
    await triage.focus();
    await triage.press("Alt+ArrowDown");
    assert.equal(await page.locator(".tasks-navigation > .nav-tab").first().getAttribute("data-key"), "Ticket-1109");
    await triage.press("Alt+ArrowDown");
    await waitUntil(async () => (await queries()).join() === "printer,triage,backlog");
    await page.evaluate(() => App.TaskManager.update("Search", { state: { query: "triage" } }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await queries(), ["printer", "triage", "backlog"]);
  });
  await t.test("merging into a positioned duplicate keeps the edited tab's position", async () => {
    const duplicate = page.locator('.zms-tab[data-zms-query="triage"]');
    await duplicate.focus();
    await duplicate.press("Alt+ArrowUp");
    await duplicate.press("Alt+ArrowUp");
    await waitUntil(async () => await page.locator(".tasks-navigation > .nav-tab").first().getAttribute("data-zms-query") === "triage");
    await search("duplicate source");
    assert.equal(await page.locator(".js-search").inputValue(), "duplicate source");
    await editSearch("triage");
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    await waitUntil(async () => {
      const stored = await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], `searchSettings:${origin}/:7`);
      return stored && !Object.hasOwn(stored.anchors, "triage");
    });
    await page.reload();
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    assert.equal(await page.locator(".tasks-navigation > .nav-tab").first().getAttribute("data-key"), "Ticket-1109");
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), ["printer", "backlog", "triage"]);
  });
  await t.test("restored tabs keep search icons when native Search initially has a ticket status", async () => {
    await worker.evaluate(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      await chrome.scripting.unregisterContentScripts({ ids: scripts.map(script => script.id) });
    });
    await page.reload();
    await page.evaluate(() => {
      document.querySelector('[data-key="Search"] .nav-tab-icon').innerHTML = '<svg class="icon icon-task-state status-open" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>';
    });
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
      await enableSite(tab);
    }, origin);
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    await waitUntil(async () => page.locator(".zms-tab").evaluateAll(tabs => tabs.every(tab => tab.querySelector(".nav-tab-icon svg.icon-searchdetail") && !tab.querySelector(".icon-task-state"))));
    assert.equal(await page.locator('[data-key="Search"] .icon-task-state').count(), 1);
    assert.deepEqual(await page.locator(".zms-tab").evaluateAll(tabs => tabs.map(tab => tab.dataset.zmsQuery)), ["printer", "backlog", "triage"]);
  });

  await t.test("existing tab icons follow late native sprite changes without replacing tabs or name drafts", async () => {
    const sprite = await page.locator("body > svg").evaluate(svg => {
      const copy = svg.cloneNode(true);
      copy.removeAttribute("style");
      return copy.outerHTML;
    });
    await page.route("**/assets/images/icons.svg*", route => route.fulfill({ contentType: "image/svg+xml", body: sprite }));
    await page.evaluate(() => {
      window.restoredIconTabs = [...document.querySelectorAll(".zms-tab")];
      document.querySelector('[data-key="Search"] .nav-tab-icon').innerHTML = '<svg class="icon icon-searchdetail"><use xlink:href="assets/images/icons.svg?revision=1#icon-searchdetail"></use></svg>';
    });
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon use").evaluateAll(uses => uses.length === 3 && uses.every(use => (use.getAttribute("href") || use.getAttribute("xlink:href")) === "assets/images/icons.svg?revision=1#icon-searchdetail")));
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon svg").evaluateAll(icons => icons.every(icon => icon.getBBox().width > 0)));
    const first = page.locator(".zms-tab").first();
    await first.hover();
    await first.locator(".zms-rename").click();
    await page.locator(".zms-name-editor").fill("Draft stays open");
    await page.evaluate(() => {
      document.querySelector('[data-key="Search"] .nav-tab-icon use').setAttribute("href", "assets/images/icons.svg?revision=2#icon-searchdetail");
      document.querySelector('[data-key="Search"] .nav-tab-close use').setAttribute("href", "assets/images/icons.svg?revision=2#icon-diagonal-cross");
    });
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon use").evaluateAll(uses => uses.length === 3 && uses.every(use => use.getAttribute("href") === "assets/images/icons.svg?revision=2#icon-searchdetail")));
    await waitUntil(async () => page.locator(".zms-close use").evaluateAll(uses => uses.length === 3 && uses.every(use => use.getAttribute("href") === "assets/images/icons.svg?revision=2#icon-diagonal-cross")));
    assert.equal(await page.locator(".zms-name-editor").inputValue(), "Draft stays open");
    assert.equal(await page.evaluate(() => window.restoredIconTabs.every((tab, index) => tab === document.querySelectorAll(".zms-tab")[index])), true);
    await page.locator(".zms-name-editor").press("Escape");
  });

  await t.test("sign-in restores visible search icons before the native tab and sprite are ready", async () => {
    await page.evaluate(() => { userId = null; });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 0);
    await page.evaluate(() => {
      const search = document.querySelector('[data-key="Search"]');
      window.delayedNativeSearch = search.outerHTML;
      search.remove();
      document.querySelector("#icon-searchdetail").remove();
      userId = "7";
    });
    await waitUntil(async () => await page.locator(".zms-tab").count() === 3);
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon svg").evaluateAll(icons => icons.length === 3 && icons.every(icon => icon.classList.contains("icon-searchdetail") && icon.getBBox().width > 0)));
    await page.evaluate(() => {
      window.signedInSearchTabs = [...document.querySelectorAll(".zms-tab")];
      document.querySelector(".tasks-navigation").insertAdjacentHTML("beforeend", window.delayedNativeSearch);
    });
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon use").evaluateAll(uses => uses.length === 3 && uses.every(use => use.getAttribute("href") === "assets/images/icons.svg?revision=2#icon-searchdetail")));
    await waitUntil(async () => page.locator(".zms-tab .nav-tab-icon svg").evaluateAll(icons => icons.every(icon => icon.getBBox().width > 0)));
    assert.equal(await page.evaluate(() => window.signedInSearchTabs.every((tab, index) => tab === document.querySelectorAll(".zms-tab")[index])), true);
    await page.screenshot({ path: path.join(__dirname, "../test-results/restored-search-icons.png") });
  });
  assert.deepEqual(errors, []);
});
