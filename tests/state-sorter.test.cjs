const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createServer } = require("../scripts/demo.cjs");

test("state order uses types, including custom names and nonsequential IDs", async () => {
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(path.join(__dirname, "../extension/state-sorter.js"), "utf8"), context);
  const groups = context.ZammadStateSorter.groupsFor([
    { id: 42, name: "Custom waiting", state_type_id: 3 }, { id: 8, name: "Custom new", state_type_id: 1 },
    { id: 4, name: "Open", state_type_id: 2 }, { id: 2, name: "Closed", state_type_id: 4 }
  ], [{ id: 1, name: "new" }, { id: 2, name: "open" }, { id: 3, name: "pending action" }, { id: 4, name: "closed" }]);
  assert.deepEqual(Array.from(groups), ["state_id:(8)", "state_id:(4)", "state_id:(42)", "NOT state_id:(4 OR 8 OR 42)"]);
});

test("page planning crosses groups and reverses workflow order without loading all results", async () => {
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(path.join(__dirname, "../extension/state-sorter.js"), "utf8"), context);
  const plan = (...args) => JSON.parse(JSON.stringify(context.ZammadStateSorter.pageSlices(...args)));
  assert.deepEqual(plan([3, 3, 3, 5], 4, 4, "ASC"), [{ index: 1, offset: 1, limit: 2 }, { index: 2, offset: 0, limit: 2 }]);
  assert.deepEqual(plan([3, 3, 3, 5], 4, 4, "DESC"), [{ index: 3, offset: 4, limit: 1 }, { index: 2, offset: 0, limit: 3 }]);
  assert.deepEqual(plan([0, 0, 0, 0], 0, 50, "ASC"), []);
  assert.deepEqual(plan([0, 2, 0, 4], 5, 50, "ASC"), [{ index: 3, offset: 3, limit: 1 }]);
});

test("workflow state sorting in the paginated search", { timeout: 90000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "search-tabs-state-sort-"));
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
    assert.ok(path.basename(temporary).startsWith("search-tabs-state-sort-"));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    channel: "chromium", headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0];
  const records = [4, 2, 12, 9, 12, 9, 4, 12, 2, 4, 9, 2, 15, 100].map((state_id, index) => ({
    id: index + 1, state_id, number: `T-${index + 1}`, title: `Printer ${index + 1}`, updated_at: index + 1
  }));
  const requests = [];
  let fail = false;
  let hold;
  let held;
  await page.route("**/sort-search?**", async route => {
    const url = new URL(route.request().url());
    const query = JSON.parse(url.searchParams.get("query"));
    const offset = JSON.parse(url.searchParams.get("offset")) || 0;
    const limit = Number(url.searchParams.get("limit"));
    const order = JSON.parse(url.searchParams.get("orderBy"));
    requests.push({ query, offset, limit, order });
    if (hold && query.includes("state_id:")) {
      held = true;
      await hold;
    }
    if (fail && query.includes("state_id:")) return route.fulfill({ status: 503, body: "Unavailable" }).catch(() => {});
    const account = route.request().headers()["x-fixture-account"];
    let result = account === "7" ? records : [{ id: 200, state_id: 2, number: "OTHER", title: "Other account", updated_at: 200 }];
    if (query.includes("nothing-found")) result = [];
    const match = query.match(/AND \((NOT )?state_id:\(([\d OR]+)\)\)$/);
    if (match) {
      const ids = match[2].split(" OR ").map(Number);
      result = result.filter(ticket => ids.includes(ticket.state_id) !== Boolean(match[1]));
    }
    result = [...result].sort((a, b) => order === "title" ? a.title.localeCompare(b.title) : b.updated_at - a.updated_at || a.id - b.id);
    await route.fulfill({ json: { Ticket: { items: result.slice(offset, offset + limit), total_count: result.length } } }).catch(() => {});
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#search/printer%20OR%20scanner");
  await page.addScriptTag({ path: path.join(__dirname, "fixtures/search-sorting.js") });
  async function waitUntil(check) {
    const deadline = Date.now() + 5000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error("Expected sorted results were not reached");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const ids = () => page.locator("#results tr").evaluateAll(rows => rows.map(row => Number(row.dataset.ticketId)));
  await waitUntil(async () => (await ids()).length === 4);
  await page.locator('input[name="bulk"]').first().check();
  await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
    await enableSite(tab);
  }, origin);
  const heading = () => page.locator(".zms-state-sort");
  await waitUntil(async () => await heading().count() === 1);

  await t.test("native state column preserves selection and sorts every page across group boundaries", async () => {
    assert.equal(await page.locator('input[name="bulk"]:checked').count(), 1);
    requests.length = 0;
    await heading().click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[8,5,3,12]");
    assert.equal(await page.locator('th[data-column-key="state_id"]').getAttribute("aria-sort"), "ascending");
    assert.equal(await page.evaluate(() => App.TaskManager.worker("Search").savedOrderBy.Ticket.page), 0);
    assert.equal(await page.evaluate(() => window.nativeStateClick), undefined);
    assert.deepEqual(await page.evaluate(() => App.Search.ticketSearchColumns), ["number", "title"]);
    assert.ok(requests.every(request => request.limit <= 4 && request.query.startsWith("(printer OR scanner) AND (")));
    assert.ok(requests.every(request => JSON.stringify(request.order) === '["updated_at","id"]'));
    assert.equal(requests.length, 6);
    await fs.mkdir(path.join(__dirname, "../test-results"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../test-results/state-sorting.png"), fullPage: true });
    await page.locator('.js-page[data-page="1"]').click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[9,2,11,6]");
    await page.locator('.js-page[data-page="2"]').click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[4,14,13,10]");
    await page.locator('.js-page[data-page="3"]').click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[7,1]");
    assert.equal(requests.filter(request => request.limit === 1 && request.offset === 0).length, 5);
  });

  await t.test("keyboard reverses the workflow and native title sorting still works", async () => {
    await heading().focus();
    await heading().press("Enter");
    await waitUntil(async () => JSON.stringify(await ids()) === "[14,13,10,7]");
    assert.equal(await page.locator('th[data-column-key="state_id"]').getAttribute("aria-sort"), "descending");
    await page.locator('th[data-column-key="title"] .js-sort').click();
    await waitUntil(async () => (await ids())[0] === 1);
    assert.equal(requests.at(-1).order, "title");
    assert.equal(requests.at(-1).query, "printer OR scanner");
  });

  await t.test("server failures keep the previous results and clear the unconfirmed sort", async () => {
    const previous = await ids();
    fail = true;
    await heading().click();
    await waitUntil(async () => (await page.locator(".zms-sort-message").textContent())?.includes("Nie udało"));
    assert.deepEqual(await ids(), previous);
    assert.equal(await page.locator('th[data-column-key="state_id"]').getAttribute("aria-sort"), "none");
    fail = false;
    await heading().click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[8,5,3,12]");
  });

  await t.test("a new query supersedes delayed sorted results", async () => {
    held = false;
    hold = new Promise(resolve => { globalThis.releaseSort = resolve; });
    await heading().click();
    await waitUntil(async () => held);
    await page.locator(".js-search").fill("another query");
    await page.locator(".js-search").press("Enter");
    await waitUntil(async () => JSON.stringify(await ids()) === "[14,13,12,11]");
    globalThis.releaseSort();
    hold = undefined;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await ids(), [14, 13, 12, 11]);
    assert.equal(await page.locator('th[data-column-key="state_id"]').getAttribute("aria-sort"), "none");
  });

  await t.test("search versions with inline table columns also support state sorting", async () => {
    await page.evaluate(() => {
      window.nativeTicketList = App.TicketList;
      delete App.Search.ticketSearchColumns;
      App.TaskManager.worker("Search").reloadCurrentSearch();
    });
    await waitUntil(async () => JSON.stringify(await ids()) === "[14,13,12,11]");
    await heading().click();
    await waitUntil(async () => JSON.stringify(await ids()) === "[8,5,3,12]");
    assert.equal(await page.evaluate(() => App.TicketList === window.nativeTicketList), true);
    assert.equal(await page.evaluate(() => Object.hasOwn(App.Search, "ticketSearchColumns")), false);
    await page.evaluate(() => { App.Search.ticketSearchColumns = ["number", "title"]; });
  });

  await t.test("empty results do not create pages or fabricate ticket rows", async () => {
    await page.locator(".js-search").fill("nothing-found");
    await page.locator(".js-search").press("Enter");
    await waitUntil(async () => (await ids()).length === 0);
    await heading().click();
    await waitUntil(async () => (await page.locator(".zms-sort-message").textContent()) === "");
    assert.equal(await page.locator(".js-page").count(), 0);
    assert.deepEqual(await ids(), []);
    await page.locator(".js-search").fill("printer");
    await page.locator(".js-search").press("Enter");
    await waitUntil(async () => (await ids()).length === 4);
  });

  await t.test("logout cancels delayed sorting and cannot render old account results", async () => {
    held = false;
    hold = new Promise(resolve => { globalThis.releaseSort = resolve; });
    await heading().click();
    await waitUntil(async () => held);
    await page.evaluate(() => { window.ignoreSortAbort = true; userId = "8"; window.loadedSortAssets = []; });
    await waitUntil(async () => page.locator(".zms-tab").count().then(count => count === 0));
    globalThis.releaseSort();
    hold = undefined;
    await page.evaluate(() => {
      const controller = App.TaskManager.worker("Search");
      controller.savedOrderBy = {};
      controller.reloadCurrentSearch();
    });
    await waitUntil(async () => JSON.stringify(await ids()) === "[200]");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await ids(), [200]);
    assert.deepEqual(await page.evaluate(() => window.loadedSortAssets), []);
  });

  await t.test("disabling restores native search and removes the added sorting controls", async () => {
    await worker.evaluate(origin => disableSite(origin, false), origin);
    await waitUntil(async () => page.locator('th[data-column-key="state_id"]').count().then(count => count === 0));
    assert.equal(await page.locator('th[data-column-key="state_id"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => App.Search.ticketSearchColumns), ["number", "title"]);
  });
  assert.deepEqual(errors, []);
});
