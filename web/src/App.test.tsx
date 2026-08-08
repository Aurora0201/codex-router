import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const responses: Record<string, unknown> = {
  "/api/health": { status: "ok", csrfToken: "test", accounts: 0, version: "0.2.0" },
  "/api/accounts": { activeAccountId: null, accounts: [] },
  "/api/sessions": [],
  "/api/settings": { gatewayAddress: "127.0.0.1", gatewayPort: 8317, upstream: "https://chatgpt.com/backend-api/codex", requestMetadataLogging: true, promptLogging: false, theme: "system" },
  "/api/stats": { uptimeSeconds: 1, activeSessions: 0, activeWebSockets: 0, requestsToday: 0, errorsToday: 0, accountsReady: 0 },
};

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("renders the operational accounts empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => responses[String(input)],
    })));
    render(<App />);
    expect(await screen.findByText("Gateway online")).toBeInTheDocument();
    expect(screen.getByText("尚未添加账号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加账号/ })).toBeInTheDocument();
  });
});
