import { access, readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

const [rootPackage, serverPackage, webPackage, lockfile] = await Promise.all([
  readJson("package.json"),
  readJson("server/package.json"),
  readJson("web/package.json"),
  readJson("package-lock.json"),
]);

const versions = new Set([rootPackage.version, serverPackage.version, webPackage.version]);
if (versions.size !== 1) throw new Error("root, server and web versions must match");
if (serverPackage.name !== "@aurora0201/codex-router" || serverPackage.private === true) {
  throw new Error("the publishable workspace metadata is invalid");
}
if (serverPackage.publishConfig?.access !== "public") throw new Error("the scoped npm package must publish as public");
if (lockfile.packages?.server?.version !== serverPackage.version) throw new Error("server lockfile version is out of sync");
if (lockfile.packages?.web?.version !== webPackage.version) throw new Error("web lockfile version is out of sync");

await Promise.all([
  access(path.join(repositoryRoot, "server", "dist", "cli.js")),
  access(path.join(repositoryRoot, "server", "web-dist", "index.html")),
]);
