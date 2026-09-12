import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

export type AdminResource = "accounts" | "stats" | "settings" | "codex" | "logs" | "websocketConnections" | "usage" | "warmup";
type Listener = (resources: AdminResource[]) => void;
export type AdminActivityEvent = { type: "request_started" | "request_finished"; id: string } | { type: "connection_updated"; connectionId: string };
type ActivityListener = (event: AdminActivityEvent) => void;

export class AdminEventHub {
  private readonly listeners = new Set<Listener>();
  private readonly activityListeners = new Set<ActivityListener>();
  private readonly pending = new Set<AdminResource>();
  /**
   * The open event streams. An SSE response never ends on its own, and Fastify
   * waits for connections that are not idle, so an admin console left open
   * would hold `app.close()` until the CLI gave up on it after ten seconds.
   */
  private readonly streams = new Set<ServerResponse>();
  private flushTimer: NodeJS.Timeout | null = null;

  /** Registers an open stream and returns the function that forgets it. */
  attach(stream: ServerResponse): () => void {
    this.streams.add(stream);
    return () => this.streams.delete(stream);
  }

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

  /**
   * Ends the open streams. Has to run in `preClose`, before Fastify starts
   * waiting: an onClose hook is too late, because by then it is already
   * waiting on the very connections this would have ended.
   */
  endStreams(): void {
    for (const stream of this.streams) if (!stream.writableEnded) stream.end();
    this.streams.clear();
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending.clear();
    this.listeners.clear();
    this.activityListeners.clear();
    this.endStreams();
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

    const detach = events.attach(reply.raw);
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
      detach();
      unsubscribe();
      unsubscribeActivity();
    });
  });
}
