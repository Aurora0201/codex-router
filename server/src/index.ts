#!/usr/bin/env node
import { buildGateway } from "./app.js";

const gateway = await buildGateway();

const shutdown = async () => {
  await gateway.app.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await gateway.app.listen({ host: gateway.config.host, port: gateway.config.port });
  gateway.app.log.info(`Gateway: http://${gateway.config.host}:${gateway.config.port}`);
  gateway.app.log.info(`Admin: http://${gateway.config.host}:${gateway.config.port}/admin`);
} catch (error) {
  gateway.app.log.error(error);
  await gateway.app.close();
  process.exitCode = 1;
}
