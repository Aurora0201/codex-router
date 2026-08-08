import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isSameOriginRequest } from "./origin-guard.js";

const COOKIE_NAME = "cg_csrf";

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((entry) => {
      const index = entry.indexOf("=");
      return [entry.slice(0, index).trim(), decodeURIComponent(entry.slice(index + 1).trim())];
    }).filter(([key]) => key.length > 0),
  );
}

function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class CsrfGuard {
  private readonly token = randomBytes(32).toString("base64url");

  issue(reply: FastifyReply): string {
    reply.header("set-cookie", `${COOKIE_NAME}=${encodeURIComponent(this.token)}; Path=/; SameSite=Strict`);
    return this.token;
  }

  verify(request: FastifyRequest): boolean {
    if (!isSameOriginRequest(request)) return false;
    const header = request.headers["x-csrf-token"];
    const cookie = parseCookies(request.headers.cookie)[COOKIE_NAME];
    return typeof header === "string" && typeof cookie === "string" && sameToken(header, this.token) && sameToken(cookie, this.token);
  }
}
