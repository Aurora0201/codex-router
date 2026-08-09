# Codex Gateway Web V2

Independent frontend workspace for the shadcn + Base UI redesign.

## Development

```bash
npm install
npm run dev
```

The preview runs at `http://127.0.0.1:5174/admin-v2/`.

## Data boundary

- `src/services/contracts.ts` defines the UI-facing service contract.
- `src/services/mock/` is the only active implementation during the product-design phase.
- The app does not proxy or request `/api`.
- A future `src/services/http/` adapter can implement the same contract without coupling pages to transport details.

The mock adapter contains fictional identifiers and does not persist data.

## Typography

- Noto Sans SC is the interface font and supplies all Chinese glyphs.
- Roboto Mono is reserved for account identifiers, addresses, transport data, and numeric usage values.
- Inter from the preset remains a Latin fallback.
