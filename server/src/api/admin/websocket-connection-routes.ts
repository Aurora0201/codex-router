import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";

export function registerWebSocketConnectionRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/websocket-connections", async () => ctx.websocketConnections.list());
}
