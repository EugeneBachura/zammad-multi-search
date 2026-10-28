const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { manifestFor, prepareExtension } = require("../scripts/build.cjs");

test("Chrome build contains the manifest and packaged runtime files", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "search-tabs-build-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("search-tabs-build-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const chrome = prepareExtension("chrome", path.join(temporary, "chrome"));
  const source = path.resolve(__dirname, "../extension");
  const files = directory => fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(path.join(directory, file)).isFile()).sort();
  assert.deepEqual(files(chrome), files(source));
  for (const file of files(chrome).filter(file => file !== "manifest.json")) {
    assert.deepEqual(fs.readFileSync(path.join(chrome, file)), fs.readFileSync(path.join(source, file)), file);
  }
  const chromeManifest = manifestFor("chrome");
  assert.equal(chromeManifest.background.service_worker, "background.js");
  assert.equal(chromeManifest.incognito, "spanning");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(chrome, "manifest.json"), "utf8")), chromeManifest);
});
