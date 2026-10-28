const fs = require("node:fs");
const path = require("node:path");

const project = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(project, "extension", "privacy.html"), "utf8");
const section = html.match(/<section>([\s\S]*?)<\/section>/)[1];
const paragraphs = [...section.matchAll(/<(h2|p)>([\s\S]*?)<\/\1>/g)].map(([, tag, text]) => {
  const content = text.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "[$2]($1)").replace(/<[^>]+>/g, "");
  return (tag === "h2" ? "## " : "") + content.trim();
});
const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)[1];
fs.mkdirSync(path.join(project, "store"), { recursive: true });
fs.writeFileSync(path.join(project, "store", "privacy-policy.md"), "# Privacy policy\n\n" + paragraphs.join("\n\n") + "\n\n" + footer + "\n");
console.log("Privacy policy synchronized from extension/privacy.html.");
