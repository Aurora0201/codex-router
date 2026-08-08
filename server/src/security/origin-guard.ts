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
  if (typeof origin !== "string") return false;
  if (origin === expectedOrigin(request)) return true;

  // The frontend may be served by a dev-server (Vite) that proxies /api to the
  // gateway while keeping the gateway's host header. The browser's Origin then
  // differs from the gateway host, but the SameSite=Strict CSRF cookie is still
  // the actual authentication proof. Treat loopback cross-origin as acceptable.
  try {
    const originUrl = new URL(origin);
    const expectedUrl = new URL(`http://${request.headers.host}`);
    const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    return loopback(originUrl.hostname) && loopback(expectedUrl.hostname);
  } catch {
    return false;
  }
}
