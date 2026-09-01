# Design system

The rules the admin console is built from. This is the single source for
frontend appearance and behaviour; where it disagrees with what the code does,
one of the two is a bug.

Most rules here were bought with a measurement, and the measurement is quoted
so a future change has to argue with the evidence rather than with taste. When
you change something this document describes, re-measure and update the number.

## Stack

React 19 + TypeScript, Vite, Tailwind CSS v4, shadcn/ui on **@base-ui/react**
(not Radix), recharts, i18next, Vitest + Testing Library.

- Tailwind v4 has no config file. Tokens are CSS variables declared in
  `web/src/index.css` under `@theme inline`.
- Utilities are generated only for classes the scanner has seen. **A class that
  appears in a file for the first time needs a dev-server restart**, or it
  silently has no CSS. Several hours have been lost to this; check the computed
  style before concluding that a rule does not work.
- Chinese strings are the i18n keys. English lives in `web/src/i18n/resources.ts`.
  A new user-facing string needs an entry there in the same commit.

## Color

### Three layers, and code reaches only the outermost

1. `--palette-*` — raw values. Never referenced from a component.
2. Semantic tokens — `background`, `card`, `muted`, `primary`, `warning`,
   `emphasis`, … defined in terms of the palette, per theme.
3. Components — consume semantic tokens alone. No `--palette-*`, no page-local
   hex, no arbitrary `oklch()` in a class.

Name a token for its role, not its appearance. `--emphasis` is the
high-emphasis analytics surface; it happens to be blue and must not be renamed
or reasoned about as "the dark card".

### Text tones

Three steps, and every one of them clears WCAG AA (4.5:1) on both grounds it
can land on — `--card` and the `--muted` inset, which is the worse of the two.

| Token | Role | Light (card / inset) | Dark (card / inset) |
| --- | --- | --- | --- |
| `--foreground` | Primary content | 19.8 | 17.2 |
| `--muted-foreground` | Secondary content, labels | 7.1 / 6.5 | 8.9 / 7.6 |
| `--muted-foreground-subtle` | Furniture: hints, captions, axis ticks | 5.0 / 4.6 | 6.9 / 5.9 |

They are not interchangeable, and there is no fourth step. **Do not reach for
an alpha modifier to invent one** — `text-muted-foreground/70` is what this
table replaced, and at 2.5:1 it put every percentage, axis tick and column
label below AA.

A value the reader compares against its neighbours is content, not furniture.
A share sitting next to the number it is a share of should never be the
faintest thing in the row.

### Status

Status always carries a text label; color is supplemental, never the only
signal.

Accent tone follows what a state asks of the reader, not what kind of state it
is:

- `--muted-foreground` when there is nothing to do — **including every healthy
  default**. A default state never wears an accent, or the exceptions have
  nothing to stand out against.
- `--warning` when it clears on its own, or is only a reminder.
- `--destructive` when routing is blocked until someone acts.
- `--primary` for the account traffic is routed through.

`--warning` and `--destructive` are tuned to the same contrast weight so
neither out-shouts the other. Re-check both themes against AA after any change
to them.

### The emphasis surface

Exactly **one** emphasis block per page, and it carries that page's headline
number. A second one means the page no longer has a hero; the usage page has a
test asserting there is only one.

- `bg-emphasis text-emphasis-foreground` outside, `bg-emphasis-surface` for its
  one inset.
- Status on it uses `--emphasis-success` / `--emphasis-warning` /
  `--emphasis-destructive`. The card tones are tuned against a light ground and
  turn to smudges here.
- Secondary text on it is `--emphasis-muted`, not `--muted-foreground`.

The two themes carry the hero by different means, and this is deliberate:

- **Light** — by value. 17.9:1 against the card. It is the one dark block on a
  white page.
- **Dark** — by hue. Lightness cannot do the job: going darker put it between
  `--background` and `--card` and it read as a hole; going lighter hit a
  ceiling of 1.5:1 before `--emphasis-muted` failed AA on it. So it is one
  saturated block among neutral grey ones — 85 units of RGB distance from
  `--card`, where the luminance ratio is only 1.45.

If you restyle the hero, the test is not "is it lighter" but "is it the only
block on the page that is not neutral".

### Charts

Series that measure the same quantity share one hue across five lightness
steps, `--chart-1` … `--chart-5`. Step 1 is the least prominent against the
theme's ground and step 5 the most — which means **the dark ramp runs the
opposite direction from the light one**, or the smallest series shouts the
loudest. Do not give such series separate hues.

### Tint

A tint on a surface is only ever `--primary` at low alpha (`/8`, `/10`), and
only to mark routing: the route summary band and the selected account's
control. Nothing else tints a surface.

## Typography

### Faces

| Token | Stack | Use |
| --- | --- | --- |
| `--font-sans` | Inter Variable → Noto Sans SC Variable | Everything on a page |
| `--font-mono` | Roboto Mono Variable → Noto Sans SC Variable | Machine text only, see below |
| `--font-logo` | Google Sans Variable | The wordmark, and nothing else |

`--font-heading` is wired into the shadcn title slots (Card, Dialog, Sheet,
AlertDialog, Empty) and currently resolves to `--font-sans`; apply it by hand
only for section titles inside those surfaces.

### The monospace rule

**Choose the face from the value, not from the slot it sits in.**

Roboto Mono carries no CJK. A mono span holding `2.9亿` renders the digits in
Roboto and falls back to Noto Sans SC for `亿` — two faces inside one string.
The same happens to `正在运行`, `已开启`, `0 小时 2 分钟`. A fact grid holds
paths, counts, timestamps and Chinese words in the same column, so the column
cannot answer the question for all of them.

Two shapes, one rule:

- `<MachineValue value={…} />` where the value is the whole contents of its own
  element.
- `cn(…, isMachineText(value) && "font-mono")` where the element already exists
  for other reasons — it carries a title, a truncation, a flex role.

**Never write a bare `font-mono`.** No value's shape is so fixed that the rule
cannot answer for it, and a filesystem path is the example that proves it:
`C:\Users\张三\.codex` is a perfectly ordinary path. `design-rules.test.ts`
asserts that every `font-mono` in `web/src` sits on a line that also names
`isMachineText`.

Names people read — model names, project paths shown as names, emails used as
labels — stay in the body face regardless, and do so naturally: they are
usually not machine text, and where they are, monospace does them no harm.

### Scale

Four sizes. Nothing between them, and nothing below.

| Class | Size | Use |
| --- | --- | --- |
| `text-xs` | 12px | Furniture: hints, captions, axis ticks, column labels |
| `text-sm` | 14px | Body, table cells, list rows, panel titles |
| `text-lg` | 18px | A panel's own reading — the number that panel exists to report |
| `text-3xl` | 30px | The page's single headline number, inside the emphasis block |

`text-[10px]` and `text-[11px]` are gone. They were three indistinguishable
steps doing three different jobs, and they made 运行状态 and 用量分析 set 85 and
109 of their text nodes at 12px or below while 请求日志 set its equivalents at
14px — the same product at two reading distances.

Page `h1` is `text-2xl font-semibold tracking-tight`. Panel titles are
`text-sm font-semibold`.

### Numbers

Every number carries `tabular-nums`, so a value that updates in place does not
shift its neighbours.

Format numbers through `@/lib/format` rather than at the call site:
`formatLatency` (ms under a second, seconds past it — never a raw float),
`formatBytes` (B through GB), `formatCountdown`, `formatUsageWindow`. Four
local spellings of "milliseconds" is how `5034.614864864865 ms` reached a
card whose whole job was to look precise.

## Surfaces

Every block is the same shell, and nesting stops at one level:

```
panel   bg-card + ring-1 ring-foreground/10 + rounded-2xl
  inset bg-muted + rounded-xl p-3          ← at most one
    tile bg-card                            ← returns to the outer surface
```

Out, in, out. Outline plus solid fill, never an outline nested inside an
outline.

- Use `ring-1 ring-foreground/10` for the panel outline, not `border`.
  `border-border` is for rules that divide content **inside** an inset.
- Radii step down inward: panel `rounded-2xl`, inset `rounded-xl`, icon tile
  `rounded-xl`/`rounded-lg`, chip `rounded-full`. Controls keep their shadcn
  radius (`rounded-md`) so they read as controls.
- All radii derive from `--radius` (0.625rem) through `--radius-sm` …
  `--radius-4xl`. Do not introduce standalone radius values; the few
  `rounded-[2px]` legend swatches are the exception and should not grow.
- A panel header that pairs a title with a hint is a **fixed band**, not
  padding around text: a set height with `items-center`. `items-baseline` sits
  the smaller hint on the title's baseline, which puts it below centre.
- Every panel title carries a lucide icon at `size-4 text-muted-foreground`
  before the text, and an optional right-aligned hint at
  `text-xs text-muted-foreground-subtle`. On `Panel` the icon is a required
  prop, so a new card cannot ship without one.

## Layout

- Page grids are `grid grid-cols-12 gap-4`. Blocks claim spans: 8/4 for a hero
  beside its breakdown, 6/6 for a pair of rankings, 12 for a reference strip.
  Card grids **inside** a panel use `gap-3`.
- A page's main card is sized by its contents and capped by the viewport, not
  pinned to full height. Pinning is what left three accounts at the top of an
  812px card with 495px of nothing under them. The scroll appears when there is
  something to scroll.
- A reference strip of long values (paths, URLs) gets fewer columns and more
  width, not more columns. Two at `sm`, three at `xl`.
- In a label/value pair on one line, the **label** keeps its width and the
  value truncates, with the full value on hover. A column of facts is scanned
  down the left.

## Shared components

Reach for these before writing markup. If you are about to write a fourth
label-above-a-number, you are writing `Figure` again.

| Component | For |
| --- | --- |
| `app/panel` — `Panel` | Any card. Title, required icon, optional hint and action, `busy`. |
| `app/figure` — `Figure` | A reading: what was measured and the number, with an optional share. |
| `app/figure` — `Fact` | A value you look up rather than compare — one line, label left. |
| `app/figure` — `Tally` | A counted thing marked with an icon. |
| `app/search-field` — `SearchField` | The one search field. |
| `app/machine-value` — `MachineValue` | A value in the face that can render it whole. |
| `request/request-outcome` — `OutcomeBadge` | A request's result. |
| `request/log-filter-controls` | The log toolbar's select, field group and account combobox. |

Non-component helpers live in `lib/`, not beside a component:
`lib/request-log.ts` (outcome and state vocabulary), `lib/pagination.ts`,
`lib/format.ts`. Exporting a constant from a `.tsx` file that also exports a
component breaks Fast Refresh and the lint rule will say so.

## Motion

Restraint is the rule. Motion exists to say something changed, never to
decorate, and never to make a fast thing feel slow.

- **Page switch** — the page container is keyed on the page, so each arrival is
  a fresh mount that settles the last 4px into place over 300ms, ease-out,
  under `motion-safe`. **No fade.** The data is already there, so starting from
  transparent only puts a blank frame in front of it, which reads as a blink.
- **Reloading after a filter change** — the previous answer stays on screen and
  the panels that depend on the filter dim to 60%. Never blank the data first;
  that collapsed the runtime hero by 50px and bounced the page.
  - Only the panels that read the filter dim. Panels fed by the snapshot do
    not — dimming 实时连接 is what made it look like it had lost its rows.
  - The dim is **derived** ("is what is on screen the answer to what was
    asked"), not a flag raised in an effect. A live gateway refreshes under the
    same filters several times a minute and a stored flag flickers.
  - It is gated behind `useSlowLoad`: 500ms before anything is said, 400ms
    minimum once said, and never on a first load — there is no previous answer
    to mark as stale, and the skeleton already says so.
- **Data swaps** — proportional bars transition their width over 500ms
  ease-out. Width can say a value moved without anything blinking. Recharts
  series keep `isAnimationActive={false}`; a sweep-in on every refetch is not
  restraint.
- `prefers-reduced-motion` is respected everywhere, and no state depends on
  animation. Pair every transition with `motion-reduce:transition-none`.
- Beware `animate-in` with `animation-fill-mode: both`: an interrupted enter
  animation leaves the element stuck at its start state, and a CSS animation
  overrides plain declarations. Prefer a transition when the element also has a
  state you control.

## Charts and aggregates

- A histogram cell covers a span someone would name — a minute, fifteen
  minutes, two hours — and the cell **count** follows from the window. A fixed
  count divided one hour into 37-second cells, which is finer than anything a
  gateway does and left the strip empty by construction.
- Read aggregates from the server, not from the sampled timeline. The timeline
  is capped at 500 rows; bucketing it client-side reports on a sample and calls
  it the window.
- A bar is a comparison. With one row, or with every row on the same value, it
  can only draw a full width, which says nothing the number beside it has not.
  Draw the number alone.
- Do not say the same thing twice. Two counts over two different denominators
  is one number with its denominator. A `200` beside every 成功 badge is what
  makes the one `429` hard to find.

## Interaction and accessibility

- Every control uses a native semantic element, a visible keyboard focus ring,
  an accessible name, and a disabled/busy state where applicable.
- Tailwind preflight leaves interactive elements on the default arrow, so
  `index.css` restores `cursor: pointer` for buttons and `role="button"`,
  `role="radio"`, `role="tab"`. A control that sets `aria-disabled` while busy
  drops out of that rule and must hold the cursor explicitly.
- Icons are lucide-react and `aria-hidden`: `size-4` in a panel header,
  `size-3.5` inline beside text, `size-[18px]` inside a `size-9` tile. An icon
  in a tile marks a subject; a bare icon marks a line.
- Anything truncated is reachable another way — a `title`, a tooltip on a
  focusable element, or the detail sheet.
- A panel whose data is reloading carries `aria-busy`.
- Dialogs trap focus, close with Escape, and restore focus to the trigger.
- Empty and error states explain the next action in plain language and use
  shadcn `Empty`.
- Keyboard shortcuts are `g` then a letter. Modifier digits are unusable: every
  browser reserves Cmd/Ctrl+1–8 for switching tabs, so a printed "⌘1" would be
  a lie.

## Writing

- Name things by what the person controls, not by how the system is built.
- An action keeps the same name through the whole flow: the button that says
  Publish produces a toast that says Published.
- Errors say what happened and what to do; they do not apologise and are never
  vague. Empty screens invite an action.
- Sentence case, plain verbs, no filler. Each element does one job — a label
  labels, an example demonstrates, and nothing quietly does double duty.

## Verification

- **Measure, do not eyeball.** Read back rendered geometry, computed colors
  sampled through a canvas, and computed font families before asserting that
  something is centred, aligned, contrast-safe or set in the right face.
  `oklch()` strings cannot be parsed as RGB — paint them into a 1×1 canvas and
  read the pixel.
- **Check both themes.** A token that works on the light card can read as a
  hole on the dark one.
- The browser pane pauses CSS transitions and throttles timers when it is
  hidden, and `document.hidden` being true also stops the app's own polling.
  A "nothing happened" result from a hidden pane is not evidence.
- The dev server must be restarted after a class appears for the first time, or
  the utility will not exist and the rule will look broken.
- **Lock a rule that took work to find into a test** — the single emphasis
  block, the pinned ranking heights, the panel header band, the meter
  thresholds, `isMachineText`, `histogramBucketMs`, `paginationTokens` — so the
  next redesign has to argue with it rather than quietly undo it.
- `web/src/design-rules.test.ts` reads the source through `import.meta.glob`
  and enforces the rules that are about *how the code is written* rather than
  what it renders: no bare `font-mono`, no `text-[10px]`/`text-[11px]`, no
  `--palette-*` outside `index.css`, and `--font-logo` only in the wordmark.
  Add to it when you find a rule a reviewer would otherwise have to remember.

## Exceptions

- All faces are bundled locally through `@fontsource-variable` and a Latin-only
  `@font-face` for the wordmark; nothing is fetched from a font service at
  runtime. System fonts remain the fallback.
- Prompt logging remains visibly locked off and must not be exposed as an
  enabled control.
