const { spawn } = require("node:child_process");
const net = require("node:net");

async function launchFirefox({ binary, driver, uuid, extensionId }) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const driverProcess = spawn(driver, ["--host", "127.0.0.1", "--port", String(port), "--log", "error", "--allow-system-access"], { windowsHide: true });
  let log = "";
  let startError;
  driverProcess.on("error", error => { startError = error; });
  for (const stream of [driverProcess.stdout, driverProcess.stderr]) stream.on("data", data => { log = (log + data).slice(-12000); });
  const baseUrl = `http://127.0.0.1:${port}`;
  let sessionId;

  async function request(endpoint, data, method = "POST") {
    const response = await fetch(baseUrl + endpoint, {
      method, signal: AbortSignal.timeout(35000), ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) } : {})
    });
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error(result.value?.message || JSON.stringify(result));
    return result.value;
  }

  try {
    const deadline = Date.now() + 10000;
    while (true) {
      if (startError) throw startError;
      try { await request("/status", null, "GET"); break; } catch {}
      if (Date.now() > deadline) throw new Error(`geckodriver did not start: ${log}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const session = await request("/session", { capabilities: { alwaysMatch: {
      browserName: "firefox",
      "moz:firefoxOptions": {
        binary, args: ["-headless", "--remote-allow-system-access"],
        prefs: { "extensions.webextensions.uuids": JSON.stringify({ [extensionId]: uuid }) }
      }
    } } });
    sessionId = session.sessionId;
    const command = (endpoint, data, method) => request(`/session/${sessionId}${endpoint}`, data, method);
    return {
      version: session.capabilities.browserVersion,
      command,
      navigate: url => command("/url", { url }),
      execute: (script, ...args) => command("/execute/sync", { script, args }),
      executeAsync: async (script, ...args) => {
        const result = await command("/execute/async", {
          script: `const done = arguments[arguments.length - 1]; Promise.resolve().then(async () => { ${script} }).then(value => done({ value }), error => done({ error: String(error) }));`, args
        });
        if (result.error) throw new Error(result.error);
        return result.value;
      },
      async close() {
        try { await command("", null, "DELETE"); } finally { driverProcess.kill(); }
      }
    };
  } catch (error) {
    driverProcess.kill();
    throw new Error(`${error.message}\n${log}`);
  }
}

module.exports = { launchFirefox };
