# @aurora0201/codex-router

Codex Router is a loopback-only account router and transparent proxy for Codex CLI. The package includes the gateway CLI and its local administration UI.

## Requirements

- Windows x64
- Node.js 24 or newer

## Install

```powershell
npm install --global @aurora0201/codex-router
codex-router start
```

Open <http://127.0.0.1:8317/admin/> after startup. Run `codex-router --help` for all commands.

Application data is stored in the operating-system data directory selected by `env-paths`. Set `GATEWAY_DATA_DIR` or pass `--data-dir` to use a specific location.

Source, documentation, and security details: <https://github.com/Aurora0201/codex-router>

## License

MIT
