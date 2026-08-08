import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
const authPath = path.join(codexHome, "auth.json");

try {
  const bytes = await readFile(authPath);
  console.log(JSON.stringify({ authPath, sha256: createHash("sha256").update(bytes).digest("hex") }));
} catch (error) {
  if (error.code === "ENOENT") console.log(JSON.stringify({ authPath, sha256: null, status: "missing" }));
  else throw error;
}
