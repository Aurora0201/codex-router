const SENSITIVE_KEYS = new Set([
  "authorization",
  "chatgpt-account-id",
  "cookie",
  "set-cookie",
  "refresh_token",
  "access_token",
  "id_token",
  "password",
  "browser_cookie",
]);

export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value]),
  );
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(entry),
      ]),
    );
  }
  return value;
}
