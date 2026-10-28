const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectDirectory = path.resolve(__dirname, "..");
const browser = process.argv[2] || "chrome";
assert.ok(["chrome", "firefox"].includes(browser), `Unknown browser: ${browser}`);
const extensionDirectory = path.resolve(projectDirectory, process.argv[3] || "extension");
const readJson = name => JSON.parse(fs.readFileSync(path.join(projectDirectory, name), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDirectory, "manifest.json"), "utf8"));
const packageInfo = readJson("package.json");
const lock = readJson("package-lock.json");
const allowedFiles = new Set([
  "manifest.json", "background.js", "bridge.js", "content.js", "search-builder.js", "tabs.css", "search-builder.css",
  "options.html", "options.js", "options.css", "privacy.html", "NOTICE.txt", "popup.html", "popup.js",
  "_locales/en/messages.json", "_locales/pl/messages.json",
  ...[16, 32, 48, 128].map(size => `icons/icon-${size}.png`)
]);

function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(directory, entry.name), name + "/") : [name];
  });
}

function bundledResource(name) {
  const resolved = path.resolve(extensionDirectory, name);
  assert.ok(resolved.startsWith(extensionDirectory + path.sep), `Resource outside package: ${name}`);
  assert.ok(fs.existsSync(resolved), `Missing resource: ${name}`);
}

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.incognito, "spanning");
if (browser === "chrome") {
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(!manifest.background.scripts);
  assert.ok(!manifest.browser_specific_settings);
} else {
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.ok(!manifest.background.service_worker);
  assert.ok(!manifest.minimum_chrome_version);
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["searchTerms"]);
  assert.ok(manifest.browser_specific_settings.gecko.id);
}
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, packageInfo.version);
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[""].version);
assert.equal(packageInfo.license, "MIT");
assert.equal(lock.packages[""].license, "MIT");
assert.ok(fs.readFileSync(path.join(extensionDirectory, "NOTICE.txt"), "utf8").includes(fs.readFileSync(path.join(projectDirectory, "LICENSE"), "utf8").trim()));
assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"].sort());
assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
assert.ok(!manifest.host_permissions?.length);
assert.ok(!manifest.externally_connectable);
assert.equal(manifest.default_locale, "en");
assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
assert.ok(!/unsafe-eval|https?:|\*/.test(manifest.content_security_policy.extension_pages));

const actualFiles = files(extensionDirectory);
assert.deepEqual([...actualFiles].sort(), [...allowedFiles].sort(), "Unexpected or missing release files");

for (const name of actualFiles) {
  if (name.endsWith(".js")) {
    const source = fs.readFileSync(path.join(extensionDirectory, name), "utf8");
    new vm.Script(source, { filename: name });
    assert.ok(!/\beval\s*\(|new\s+Function\b|importScripts\s*\(/.test(source), `Dynamic code in ${name}`);
    assert.ok(!/[\u0400-\u04ff]/u.test(source), `Unsupported interface language in ${name}`);
  }
  if (name.endsWith(".html")) {
    const html = fs.readFileSync(path.join(extensionDirectory, name), "utf8");
    assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(html), `Inline script in ${name}`);
    assert.ok(!/\son\w+\s*=/i.test(html), `Inline handler in ${name}`);
    for (const [, source] of html.matchAll(/<script[^>]+src="([^"]+)"/gi)) bundledResource(source);
    for (const [, source] of html.matchAll(/<link[^>]+href="([^"]+)"/gi)) bundledResource(source);
    for (const [, source] of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) bundledResource(source);
  }
}

for (const locale of ["en", "pl"]) {
  const messages = JSON.parse(fs.readFileSync(path.join(extensionDirectory, "_locales", locale, "messages.json"), "utf8"));
  assert.ok(messages.extensionName.message.length <= 75);
  assert.ok(messages.extensionDescription.message.length <= 132);
}

for (const size of [16, 32, 48, 128]) {
  const file = `icons/icon-${size}.png`;
  assert.equal(manifest.icons[size], file);
  assert.equal(manifest.action.default_icon[size], file);
  const png = fs.readFileSync(path.join(extensionDirectory, file));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}

console.log(`${browser} ${manifest.version}: ${actualFiles.length} files, bundled resources and icon sizes checked.`);
