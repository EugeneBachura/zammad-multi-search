const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const project = fs.realpathSync(path.resolve(__dirname, ".."));
const distribution = path.join(project, "dist");
const destination = path.join(distribution, "github-source");
const version = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).version;
const rootFiles = [".gitattributes", ".gitignore", "LICENSE", "package.json", "package-lock.json"];
const scripts = ["build.cjs", "check-release.cjs", "demo.cjs", "export-icons.ps1", "package.ps1", "prepare-github.cjs", "store-assets.cjs", "sync-privacy.cjs"];
const tests = ["build.test.cjs", "extension.test.cjs", "firefox.test.cjs", "lifecycle.test.cjs", "private.test.cjs", "search-builder.test.cjs", "fixtures/zammad.html", "helpers/firefox.cjs"];
const storeFiles = ["description-en.txt", "description-pl.txt", "privacy-policy.md", `release-notes-${version}.txt`];

function filesUnder(directory) {
  return fs.readdirSync(path.join(project, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${relative}`);
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  });
}

execFileSync(process.execPath, [path.join(project, "scripts/check-release.cjs")], { cwd: project, stdio: "inherit" });
const files = [
  ...rootFiles,
  ...filesUnder("extension"),
  ...scripts.map(file => `scripts/${file}`),
  ...tests.map(file => `tests/${file}`),
  ...storeFiles.map(file => `store/${file}`),
  ...filesUnder("store/images"),
  "manifests/firefox.json", "assets/icon-source.png", "assets/promo-artwork.png", "docs/github-readme.md"
].sort();
for (const file of files) {
  if (!fs.statSync(path.join(project, file)).isFile()) throw new Error(`Source file is missing: ${file}`);
}

fs.mkdirSync(distribution, { recursive: true });
if (fs.realpathSync(distribution) !== distribution) throw new Error("The distribution directory must stay inside the project.");
if (fs.existsSync(destination) && fs.realpathSync(destination) !== destination) throw new Error("The publication directory must stay inside dist.");
if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination);
for (const file of files) {
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(project, file), target);
}
const readme = fs.readFileSync(path.join(project, "docs/github-readme.md"), "utf8").replaceAll("{{version}}", version);
fs.writeFileSync(path.join(destination, "README.md"), readme);
const manifest = [...files, "README.md"].sort().map(file => {
  const data = fs.readFileSync(path.join(destination, file));
  return { path: file, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
});
fs.writeFileSync(path.join(distribution, "github-source-manifest.json"), JSON.stringify({ version, files: manifest }, null, 2) + "\n");
console.log(`GitHub source ${version}: ${manifest.length} files, ${manifest.reduce((total, file) => total + file.bytes, 0)} bytes.`);
console.log(destination);
