# Frontend Guidelines

## Stack and sources

- The admin UI lives in `web/` and uses React, TypeScript, Vite, Tailwind CSS, and local shadcn-style primitives.
- Product behavior and required pages come from `codex-gateway-mvp-design.md`.
- Use Noto Sans SC for interface copy and Roboto Mono for identifiers and transport data, with system fallbacks.

## Styling contract

- Use Tailwind utility classes for layout and component styling.
- Keep `web/src/index.css` limited to Tailwind import, CSS variables, base element rules, and the single transport-trace treatment.
- Do not add CSS Modules or CSS-in-JS.
- The visual direction is a compact local network console: quiet ink/slate surfaces with cyan/teal reserved for connectivity and safety state.

## Tokens

- Define colors, radii, shadows, and font families as CSS variables in `web/src/index.css`.
- Consume semantic tokens (`background`, `card`, `muted`, `border`, `primary`, `destructive`) instead of page-local hex colors.
- Status must always include a text label; color is supplemental.

## Component seams

- Reusable primitives live in `web/src/components/ui/`.
- Cohesive product widgets live in `web/src/components/`.
- Pages live in `web/src/pages/` and compose existing components; they do not own reusable dialog, badge, button, or empty-state behavior.
- Shared API types and fetch behavior live in `web/src/lib/api.ts`.

## Reuse gate

- Search `web/src/components/ui`, `web/src/components`, and direct imports before creating a component.
- Reuse an existing interface when it fits; extend a semantic variant for the same role; create a component only for a new role or repeated cohesive unit.
- Import components directly from their files; do not add broad barrel exports.

## Page composition

- Keep Accounts, Sessions, and Settings as separate page components selected by the top-level app shell.
- Desktop layouts may use dense tables and side panels; below tablet width, switch to readable stacked cards without horizontal scrolling.
- The transport trace is the sole signature visual and must encode live Gateway-to-account flow, not serve as decoration.

## Interaction and accessibility

- Every control uses a native semantic element, visible keyboard focus, an accessible name, and a disabled/busy state where applicable.
- Dialogs trap focus, close with Escape, and restore focus to the trigger.
- Respect `prefers-reduced-motion`; no essential state may depend on animation.
- Empty and error states explain the next action in plain language.

## Exceptions

- Google Fonts are loaded from the official service for the MVP; system fonts remain valid offline fallbacks.
- Prompt logging remains visibly locked off and must not be exposed as an enabled control.
