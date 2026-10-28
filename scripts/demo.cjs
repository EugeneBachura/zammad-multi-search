const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fs.readFileSync(path.join(__dirname, "../tests/fixtures/zammad.html")));
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(8090, "127.0.0.1", () => {
    console.log("Zammad task bar fixture: http://127.0.0.1:8090");
  });
}

module.exports = { createServer };
