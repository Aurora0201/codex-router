import type { FastifyRequest } from "fastify";

export function hasBrowserOrigin(request: FastifyRequest): boolean {
  return typeof request.headers.origin === "string" || typeof request.headers.referer === "string";
}

export function expectedOrigin(request: FastifyRequest): string {
  const host = request.headers.host;
  if (!host) throw new Error("missing_host_header");
  return `http://${host}`;
}

export function isSameOriginRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin === expectedOrigin(request);
}
