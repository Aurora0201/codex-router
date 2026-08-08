import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "account/login/start") result = { loginId: "login-1", authUrl: "https://auth.openai.test/authorize" };
  if (message.method === "account/read") result = { account: { email: "owner@example.test", planType: "plus" } };
  if (message.method === "account/rateLimits/read") result = { primary: { usedPercent: 25, resetsAt: 2_000_000_000, windowDurationMins: 300 } };
  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
