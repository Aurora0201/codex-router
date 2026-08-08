import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";

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
