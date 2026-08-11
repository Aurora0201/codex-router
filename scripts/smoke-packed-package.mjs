import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const tarball = process.argv[2];
if (!tarball) throw new Error("usage: node scripts/smoke-packed-package.mjs <package.tgz>");

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-router-pack-smoke-"));
const installRoot = path.join(temporaryRoot, "install");
const dataDir = path.join(temporaryRoot, "data");

function runCli(cliPath, args) {
  return execFileSync(process.execPath, [cliPath, ...args], { encoding: "utf8", timeout: 30_000 });
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("unable to reserve a port"));
      server.close(() => resolve(address.port));
    });
  });
}

let cliPath;
let port;
try {
  const npmArguments = ["install", "--prefix", installRoot, "--omit=dev", "--no-audit", "--no-fund", path.resolve(tarball)];
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  execFileSync(process.platform === "win32" ? process.execPath : "npm", process.platform === "win32" ? [npmCli, ...npmArguments] : npmArguments, {
    stdio: "inherit",
    timeout: 120_000,
  });
  cliPath = path.join(installRoot, "node_modules", "@aurora0201", "codex-router", "dist", "cli.js");
  const packageMetadata = JSON.parse(await readFile(path.join(installRoot, "node_modules", "@aurora0201", "codex-router", "package.json"), "utf8"));
  if (packageMetadata.name !== "@aurora0201/codex-router") throw new Error("unexpected installed package");

  port = await freePort();
  runCli(cliPath, ["start", "--host", "127.0.0.1", "--port", String(port), "--data-dir", dataDir]);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => {
    if (!response.ok) throw new Error(`health check failed: ${response.status}`);
    return response.json();
  });
  if (health.status !== "ok") throw new Error("unexpected health response");

  const admin = await fetch(`http://127.0.0.1:${port}/admin/`);
  if (!admin.ok || !(await admin.text()).includes("<title>codex-router</title>")) {
    throw new Error("packaged admin UI is unavailable");
  }

  runCli(cliPath, ["status", "--host", "127.0.0.1", "--port", String(port), "--data-dir", dataDir]);
} finally {
  if (cliPath && port) {
    try {
      runCli(cliPath, ["stop", "--host", "127.0.0.1", "--port", String(port), "--data-dir", dataDir]);
    } catch {
      // The test failure is reported by the original operation.
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
