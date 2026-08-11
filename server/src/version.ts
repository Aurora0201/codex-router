import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const metadata = require("../package.json") as { version: string };

export const GATEWAY_VERSION = metadata.version;
