#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { buildGateway } from "./app.js";
import type { GatewayConfig } from "./types.js";
import { printBanner } from "./banner.js";
import { pidFilePath, removePidFile, writePidFile } from "./pid.js";

export async function startGateway(overrides: Partial<GatewayConfig> = {}): Promise<void> {
  const gateway = await buildGateway(overrides);
  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    await removePidFile(gateway.config.dataDir);
    await gateway.app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await gateway.app.listen({ host: gateway.config.host, port: gateway.config.port });
    await writePidFile(gateway.config.dataDir);
    gateway.app.log.info(`Gateway: http://${gateway.config.host}:${gateway.config.port}`);
    gateway.app.log.info(`Admin: http://${gateway.config.host}:${gateway.config.port}/admin`);
    gateway.app.log.info(`PID: ${process.pid} (-> ${pidFilePath(gateway.config.dataDir)})`);
  } catch (error) {
    gateway.app.log.error(error);
    await gateway.app.close();
    process.exitCode = 1;
  }
}

const isMainEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainEntry) {
  printBanner();
  await startGateway();
}
