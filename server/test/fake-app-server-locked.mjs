// Fake app-server that mirrors the real codex behavior that broke logins on
// Windows: it spawns a detached grandchild process whose working directory is
// CODEX_HOME and which survives briefly after the server process exits. A
// directory that is the CWD of a live process cannot be renamed or removed on
// Windows (EBUSY/EPERM), which reproduces the failure a plain `fs.rename`
// hits against the staging directory.
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const lockMs = Number(process.env.CODEX_FAKE_LOCK_MS ?? 4000);

function holdCodexHome() {
  const home = process.env.CODEX_HOME;
  const clone = path.join(home, ".tmp", "plugins-clone-test");
  fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
  fs.writeFileSync(path.join(clone, ".git", "config"), "[remote \"origin\"]\n\turl = https://github.com/openai/plugins.git\n");
  const deadline = Date.now() + lockMs;
  const child = spawn(process.execPath, ["-e", `
    process.chdir(process.argv[1]);
    const hold = () => {
      if (Date.now() >= Number(process.argv[2])) process.exit(0);
      setTimeout(hold, 200);
    };
    setTimeout(hold, 200);
  `, clone, String(deadline)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: clone,
  });
  child.unref();
}

holdCodexHome();

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  fs.appendFileSync(path.join(process.env.CODEX_HOME, "rpc.log"), `${JSON.stringify({ method: message.method, params: message.params })}\n`);
  if (message.method === "account/login/start") {
    result = { loginId: "login-1", authUrl: "https://auth.openai.test/authorize" };
    fs.writeFileSync(path.join(process.env.CODEX_HOME, "auth.json"), JSON.stringify({ tokens: { access_token: "isolated-access", account_id: "isolated-account", refresh_token: "managed-by-codex" } }));
  }
  if (message.method === "account/read") result = { account: { email: "owner@example.test", planType: "plus" } };
  if (message.method === "account/rateLimits/read") result = { rateLimits: { primary: { usedPercent: 25, resetsAt: 2_000_000_000, windowDurationMins: 300 }, secondary: { usedPercent: 10, resetsAt: 2_000_000_100, windowDurationMins: 10080 } } };
  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
