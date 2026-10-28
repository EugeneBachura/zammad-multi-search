const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createServer } = require("./demo.cjs");

async function captureFeature(page, filename, locale, feature) {
  await page.evaluate(({ locale, feature }) => {
    const english = locale === "en";
    const selectors = feature === "tabs"
      ? [".zms-tab", ".global-search"]
      : [feature === "groups" ? ".zms-builder-group" : ".zms-builder-rows", ".zms-builder-query"];
    const regions = selectors.map(selector => {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) throw new Error(`Screenshot target missing: ${selector}`);
      const rectangles = elements.map(element => {
        const rectangle = element.getBoundingClientRect();
        const editor = element.closest(".zms-builder-editor")?.getBoundingClientRect();
        return {
          left: rectangle.left, right: rectangle.right,
          top: Math.max(rectangle.top, editor?.top ?? 0),
          bottom: Math.min(rectangle.bottom, editor?.bottom ?? innerHeight)
        };
      });
      const x = Math.max(4, Math.min(...rectangles.map(rectangle => rectangle.left)) - 5);
      const y = Math.max(4, Math.min(...rectangles.map(rectangle => rectangle.top)) - 5);
      return {
        x, y,
        width: Math.min(innerWidth - 4, Math.max(...rectangles.map(rectangle => rectangle.right)) + 5) - x,
        height: Math.min(innerHeight - 4, Math.max(...rectangles.map(rectangle => rectangle.bottom)) + 5) - y
      };
    });
    const shape = region => `x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="5"`;
    function note(x, y, width, lines, size = 18) {
      const text = lines.map((line, index) => `<tspan x="14" y="${size + 12 + index * (size + 8)}">${line}</tspan>`).join("");
      return `<g transform="translate(${x} ${y})" stroke="none" marker-end="none">
        <rect width="${width}" height="${lines.length * (size + 8) + 24}" rx="7" fill="#064f69"/>
        <text fill="white" font-family="Arial, sans-serif" font-size="${size}" font-weight="600">${text}</text>
      </g>`;
    }
    let annotations;
    if (feature === "tabs") {
      annotations = note(342, 336, 566, english ? ["Name and reorder search tabs", "Switch searches on the same page."] : ["Nazwij i uporządkuj zakładki", "Przełączaj je na tej samej stronie."], 27)
        + note(884, 88, 260, english ? ["New global search"] : ["Nowe wyszukiwanie"])
        + '<path d="M342 377 C290 377 322 186 274 186"/>'
        + '<path d="M1000 88 L1000 61"/>';
    } else {
      const lines = feature === "groups"
        ? (english ? ["AND / OR", "and NOT"] : ["AND / OR", "oraz NOT"])
        : (english ? ["Choose", "conditions"] : ["Wybierz", "warunki"]);
      annotations = note(16, 322, 128, lines)
        + note(16, 638, 128, english ? ["Query", "preview"] : ["Podgląd", "zapytania"])
        + `<path d="M144 360 L${regions[0].x - 9} 360"/>`
        + `<path d="M144 677 L${regions[1].x - 9} 677"/>`;
    }
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.dataset.storeFocus = "true";
    overlay.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    overlay.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none";
    const cutouts = regions.map(region => `<rect ${shape(region)} fill="black"/>`).join("");
    const outlines = regions.map(region => `<rect ${shape(region)} fill="none" stroke="#ffca4a" stroke-width="3"/>`).join("");
    overlay.innerHTML = `
      <defs>
        <mask id="store-focus-mask"><rect width="100%" height="100%" fill="white"/>${cutouts}</mask>
        <marker id="store-focus-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
          <path d="M0 0 L8 4 L0 8" fill="none" stroke="#ffca4a" stroke-width="2"/>
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="#071b2c" opacity="0.45" mask="url(#store-focus-mask)"/>
      ${outlines}
      <g fill="none" stroke="#ffca4a" stroke-width="3" marker-end="url(#store-focus-arrow)">${annotations}</g>
      <text x="16" y="782" fill="white" font-family="Arial, sans-serif" font-size="12">${english ? "Demo workspace with sample data" : "Środowisko demonstracyjne z przykładowymi danymi"}</text>`;
    (document.querySelector("dialog[open]") || document.body).append(overlay);
  }, { locale, feature });
  try {
    await page.screenshot({ path: filename });
  } finally {
    await page.locator("[data-store-focus]").evaluate(element => element.remove());
  }
}

async function generate() {
  const project = path.resolve(__dirname, "..");
  const output = path.join(project, "store", "images");
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "search-tabs-assets-"));
  const extension = path.join(temporary, "extension");
  const server = createServer();
  let context;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await fs.cp(path.join(project, "extension"), extension, { recursive: true });
    const manifestPath = path.join(extension, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.host_permissions = ["http://127.0.0.1/*"];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
      channel: "chromium", headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const page = context.pages()[0];
    for (const locale of ["en", "pl"]) {
      await worker.evaluate(() => chrome.storage.local.clear());
      await page.goto(origin);
      await page.evaluate(locale => {
        const english = locale === "en";
        document.documentElement.lang = locale;
        const get = App.Session.get;
        App.Session.get = key => key === "preferences" ? { locale } : get(key);
        if (english) App.i18n.translateInline = value => ({ new: "New", open: "Open", closed: "Closed", "needs triage": "Needs triage", "1 low": "Low", "2 normal": "Normal", "3 high": "High", "4 urgent": "Urgent" })[value] || value;
        document.querySelector(".header strong").textContent = "Search Tabs for Zammad";
        document.querySelector(".header span").textContent = english ? "Demo workspace" : "Wersja demonstracyjna";
        document.querySelector(".header span").style.marginLeft = "0";
        document.querySelector(".header strong").style.fontSize = "18px";
        document.querySelector("#search-view > h1").textContent = english ? "Search" : "Wyszukiwanie";
        document.querySelector(".notice").textContent = english
          ? "Demonstration with sample data. Search tabs and filters below are provided by the extension."
          : "Demonstracja z przykładowymi danymi. Zakładki wyszukiwania i filtry poniżej pochodzą z rozszerzenia.";
        document.querySelector(".global-search-input").placeholder = english ? "New search" : "Nowe wyszukiwanie";
        document.querySelector(".js-search").placeholder = english ? "Search in Zammad" : "Szukaj w Zammad";
        if (english) {
          document.querySelectorAll(".js-nativeSearch, .global-search button").forEach(button => { button.textContent = "Search"; });
          document.querySelectorAll("th").forEach((cell, index) => { cell.textContent = ["Number", "Title", "State"][index]; });
          document.querySelectorAll(".js-shortcut").forEach((button, index) => { button.textContent = ["Open tickets", "Library", "Printers"][index]; });
          document.querySelector('[data-key="Ticket-1109"] .nav-tab-name').textContent = "Sample ticket";
        }
        document.querySelector(".examples").remove();
      }, locale);
      await worker.evaluate(async origin => {
        const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
        await enableSite(tab);
      }, origin);
      for (const query of ["state.name:open", 'priority.name:"3 high"', "printer", "created_at:>now-7d"]) {
        await page.locator(".global-search-input").fill(query);
        await page.locator(".global-search-input").press("Enter");
        await page.waitForFunction(query => document.querySelector(".js-search").value === query && [...document.querySelectorAll(".zms-tab")].some(tab => tab.dataset.zmsQuery === query), query);
      }
      await page.evaluate(locale => {
        document.querySelector(".global-search-input").value = "";
        document.querySelector("#results-title").textContent = locale === "en" ? "Sample results" : "Przykładowe wyniki";
        document.querySelectorAll("#results tr").forEach((row, index) => {
          row.cells[1].textContent = (locale === "en" ? ["Printer setup", "Network connection", "New workstation"] : ["Konfiguracja drukarki", "Połączenie sieciowe", "Nowe stanowisko"])[index];
          row.cells[2].textContent = locale === "en" ? "Open" : "Otwarte";
        });
      }, locale);
      const names = locale === "en" ? ["Open tickets", "High priority", "Printers", "Last 7 days"] : ["Otwarte zgłoszenia", "Wysoki priorytet", "Drukarki", "Ostatnie 7 dni"];
      for (let index = 0; index < names.length; index++) {
        const tab = page.locator(".zms-tab").nth(index);
        await tab.hover();
        await tab.locator(".zms-rename").click();
        await page.locator(".zms-name-editor").fill(names[index]);
        await page.locator(".zms-name-editor").press("Enter");
      }
      await page.locator(".global-search-input").focus();
      await page.locator(".zms-tab").first().hover();
      await captureFeature(page, path.join(output, `screenshot-${locale}-tabs.png`), locale, "tabs");
      await page.locator(".zms-builder-launch").click();
      const dialog = page.locator("dialog.zms-builder");
      await dialog.locator(".zms-builder-base").fill("");
      await dialog.locator('[data-field="state"].zms-builder-field').click();
      await dialog.locator('[data-value="open"].zms-builder-choice').click();
      await dialog.locator('[data-field="created"].zms-builder-field').click();
      await dialog.locator('[data-field="group"].zms-builder-field').click();
      await dialog.locator('[data-field="group"].zms-builder-condition input').fill("IT Helpdesk");
      await dialog.locator(".zms-builder-query").click();
      await captureFeature(page, path.join(output, `screenshot-${locale}-filters.png`), locale, "filters");
      await dialog.locator(".zms-builder-cancel").click();
      await page.locator(".zms-builder-launch").click();
      await dialog.locator(".zms-builder-base").fill("printer");
      await dialog.locator(".zms-builder-add-group").click();
      await dialog.locator('.zms-builder-group [data-join="any"]').click();
      await dialog.locator('.zms-builder-field[data-field="state"]').click();
      await dialog.locator('.zms-builder-choice[data-value="open"]').click();
      await dialog.locator('.zms-builder-field[data-field="priority"]').click();
      await dialog.locator('.zms-builder-choice[data-value="3 high"]').click();
      await dialog.locator(".zms-builder-group > .zms-builder-group-logic > .zms-builder-negate").click();
      await dialog.locator(".zms-builder-editor").evaluate(editor => { editor.scrollTop = 0; });
      await dialog.locator(".zms-builder-query").click();
      await captureFeature(page, path.join(output, `screenshot-${locale}-groups.png`), locale, "groups");
      await dialog.locator(".zms-builder-cancel").click();
    }
    const artwork = await fs.readFile(path.join(project, "assets", "promo-artwork.png"));
    const imageUrl = `data:image/png;base64,${artwork.toString("base64")}`;
    const tile = await context.newPage();
    for (const locale of ["en", "pl"]) {
      for (const [width, height, name] of [[440, 280, "small-tile"], [1400, 560, "marquee"]]) {
        await tile.setViewportSize({ width, height });
        const small = width === 440;
        const subtitle = locale === "en" ? "Multiple searches.\nOne Zammad page." : "Wiele wyszukiwań.\nJedna strona Zammad.";
        await tile.setContent(`<!doctype html><html lang="${locale}"><style>
          *{box-sizing:border-box}body{margin:0;background:linear-gradient(115deg,#063c50,#075e74);color:white;font-family:Arial,sans-serif}
          main{height:${height}px;display:flex;align-items:center;gap:${small ? 14 : 76}px;padding:${small ? 24 : 72}px}
          img{flex:none;width:${small ? 140 : 360}px;height:auto}
          h1{font-size:${small ? 27 : 64}px;line-height:1.08;margin:0 0 ${small ? 16 : 28}px;letter-spacing:-.025em}
          h1 span{font-weight:400;font-size:.64em}p{font-size:${small ? 15 : 30}px;line-height:1.5;white-space:pre-line;margin:0;color:#d7f1f7}
        </style><main><img src="${imageUrl}" alt=""><div><h1>Search Tabs<br><span>for Zammad</span></h1><p>${subtitle}</p></div></main></html>`);
        await tile.screenshot({ path: path.join(output, `${name}-${locale}.png`) });
      }
    }
    await fs.copyFile(path.join(project, "extension", "icons", "icon-128.png"), path.join(output, "store-icon-128.png"));
    const images = await fs.readdir(output);
    for (const name of images.filter(name => name.endsWith(".png"))) {
      const png = await fs.readFile(path.join(output, name));
      console.log(`${name}: ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)}`);
    }
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("search-tabs-assets-"));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
