import type { FastifyInstance } from "fastify";

export type AdminResource = "accounts" | "stats" | "settings" | "codex" | "logs" | "websocketConnections";
type Listener = (resources: AdminResource[]) => void;
export type AdminActivityEvent = { type: "request_started" | "request_finished"; id: string } | { type: "connection_updated"; connectionId: string };
type ActivityListener = (event: AdminActivityEvent) => void;

export class AdminEventHub {
  private readonly listeners = new Set<Listener>();
  private readonly activityListeners = new Set<ActivityListener>();
  private readonly pending = new Set<AdminResource>();
  private flushTimer: NodeJS.Timeout | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeActivity(listener: ActivityListener): () => void { this.activityListeners.add(listener); return () => this.activityListeners.delete(listener); }
  emitActivity(event: AdminActivityEvent): void { for (const listener of this.activityListeners) listener(event); }

  invalidate(...resources: AdminResource[]): void {
    for (const resource of resources) this.pending.add(resource);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 100);
    this.flushTimer.unref();
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending.clear();
    this.listeners.clear();
    this.activityListeners.clear();
  }

  private flush(): void {
    this.flushTimer = null;
    const resources = [...this.pending];
    this.pending.clear();
    if (resources.length === 0) return;
    for (const listener of this.listeners) listener(resources);
  }
}

export function registerAdminEventRoutes(app: FastifyInstance, events: AdminEventHub): void {
  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const unsubscribe = events.subscribe((resources) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: invalidate\ndata: ${JSON.stringify({ resources })}\n\n`);
      }
    });
    const unsubscribeActivity = events.subscribeActivity((event) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": heartbeat\n\n");
    }, 15_000);
    heartbeat.unref();

    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeActivity();
    });
  });
}
