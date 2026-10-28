const fs = require("node:fs");
const path = require("node:path");

const projectDirectory = path.resolve(__dirname, "..");
const sourceDirectory = path.join(projectDirectory, "extension");

function manifestFor(browser) {
  if (!["chrome", "firefox"].includes(browser)) throw new Error(`Unknown browser: ${browser}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDirectory, "manifest.json"), "utf8"));
  if (browser === "firefox") {
    const settings = JSON.parse(fs.readFileSync(path.join(projectDirectory, "manifests", "firefox.json"), "utf8"));
    delete manifest.minimum_chrome_version;
    Object.assign(manifest, settings);
  }
  return manifest;
}

function prepareExtension(browser, destination = path.join(projectDirectory, "dist", browser)) {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(sourceDirectory, destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifestFor(browser), null, 2) + "\n");
  return destination;
}

if (require.main === module) {
  const requested = process.argv[2] || "chrome";
  for (const browser of requested === "all" ? ["chrome", "firefox"] : [requested]) {
    console.log(`${browser}: ${prepareExtension(browser)}`);
  }
}

module.exports = { manifestFor, prepareExtension };
