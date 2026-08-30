import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  fs.appendFileSync(path.join(process.env.CODEX_HOME, "rpc.log"), `${JSON.stringify({ method: message.method, params: message.params })}\n`);
  if (message.method === "account/read" && fs.existsSync(path.join(process.env.CODEX_HOME, "force-transient"))) {
    process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: -32000, message: "temporary service unavailable" } })}\n`);
    return;
  }
  if (message.method === "account/login/start") {
    result = { loginId: "login-1", authUrl: "https://auth.openai.test/authorize" };
    fs.writeFileSync(path.join(process.env.CODEX_HOME, "auth.json"), JSON.stringify({ tokens: { access_token: "isolated-access", account_id: "isolated-account", refresh_token: "managed-by-codex", fedramp: process.env.CODEX_FAKE_FEDRAMP === "1" } }));
  }
  if (message.method === "account/read") {
    const authPath = path.join(process.env.CODEX_HOME, "auth.json");
    if (!fs.existsSync(authPath)) fs.writeFileSync(authPath, JSON.stringify({ tokens: { access_token: "isolated-access", account_id: "isolated-account", refresh_token: "managed-by-codex" } }));
    result = fs.existsSync(path.join(process.env.CODEX_HOME, "force-relogin")) ? { account: null } : { account: { type: "chatgpt", email: "owner@example.test", planType: "plus" } };
  }
  if (message.method === "account/rateLimits/read") result = { rateLimits: { primary: { usedPercent: 25, resetsAt: 2_000_000_000, windowDurationMins: 300 }, secondary: { usedPercent: 10, resetsAt: 2_000_000_100, windowDurationMins: 10080 }, credits: { hasCredits: true, unlimited: false, balance: "42" }, individualLimit: { limit: "100", used: "20", remainingPercent: 80, resetsAt: 2_000_100_000 }, spendControlReached: false }, rateLimitResetCredits: { availableCount: 1, credits: [{ id: "credit-1", resetType: "weekly", status: "available", grantedAt: 2_000_000_000, expiresAt: 2_000_100_000 }] } };
  if (message.method === "account/rateLimitResetCredit/consume") result = { outcome: message.params?.creditId === "already" ? "alreadyRedeemed" : "reset" };
  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
