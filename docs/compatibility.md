# Compatibility baseline

- Verified: 2026-08-08
- Node.js: 24.12.0
- Official Codex CLI: 0.147.0 (locked by `package-lock.json`)
- App-server transport: `stdio://`
- Account methods verified from generated official schema: `account/login/start`, `account/login/completed`, `account/read`, `account/rateLimits/read`
- Data-plane smoke coverage: models, HTTP/SSE, opaque tool loop, compact, WebSocket, OAuth adapter, token refresh adapter

Run the full compatibility smoke test after changing `@openai/codex`:

```powershell
npm test
npm run build
```
