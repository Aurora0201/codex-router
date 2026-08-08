import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CredentialSnapshot } from "../types.js";

const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;

export class CredentialFormatError extends Error {
  constructor(message = "codex_auth_file_incompatible") {
    super(message);
    this.name = "CredentialFormatError";
  }
}
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CredentialFormatError();
  return value as Record<string, unknown>;
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    return asObject(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return {};
  }
}

function readString(object: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof object[key] === "string" && object[key]) return object[key] as string;
  }
  return null;
}

function authClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload["https://api.openai.com/auth"];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : {};
}

function detectFedRamp(...objects: Record<string, unknown>[]): boolean {
  for (const object of objects) {
    if (object.fedramp === true || object.is_fedramp === true) return true;
    const values = [object.environment, object.workspace_type, object.organization_type, object.account_type];
    if (values.some((value) => typeof value === "string" && value.toLowerCase().includes("fedramp"))) return true;
  }
  return false;
}

export class CredentialReader {
  async read(codexHome: string): Promise<CredentialSnapshot> {
    const authPath = path.join(codexHome, "auth.json");
    const file = await readFile(authPath);
    if (file.byteLength > MAX_AUTH_FILE_BYTES) throw new CredentialFormatError("codex_auth_file_too_large");

    let root: Record<string, unknown>;
    try {
      root = asObject(JSON.parse(file.toString("utf8")));
    } catch (error) {
      if (error instanceof CredentialFormatError) throw error;
      throw new CredentialFormatError();
    }

    const tokens = root.tokens && typeof root.tokens === "object" && !Array.isArray(root.tokens)
      ? root.tokens as Record<string, unknown>
      : root;
    const accessToken = readString(tokens, "access_token", "accessToken");
    const idToken = readString(tokens, "id_token", "idToken") ?? undefined;
    const claims = decodeJwtPayload(idToken);
    const auth = authClaims(claims);
    const accountId = readString(tokens, "account_id", "accountId")
      ?? readString(auth, "chatgpt_account_id", "account_id")
      ?? readString(claims, "chatgpt_account_id", "account_id");

    if (!accessToken || !accountId) throw new CredentialFormatError();

    return {
      accessToken,
      accountId,
      fedRamp: detectFedRamp(root, tokens, claims, auth),
      email: readString(auth, "chatgpt_user_email", "email") ?? readString(claims, "email"),
      planType: readString(auth, "chatgpt_plan_type", "plan_type") ?? readString(claims, "plan_type"),
      loadedAt: Date.now(),
    };
  }
}
