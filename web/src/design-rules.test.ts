import { describe, expect, it } from "vitest"

// Read through Vite rather than node:fs, so the file stays inside the app's
// own TypeScript project instead of needing node types added to it.
const sources = Object.entries(
  import.meta.glob<string>("./**/*.{ts,tsx}", {
    query: "?raw",
    eager: true,
    import: "default",
  })
).filter(([file]) => !/\.test\.tsx?$/.test(file))

function linesMatching(pattern: RegExp): string[] {
  return sources.flatMap(([file, source]) =>
    source
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file}:${index + 1}`] : []
      )
  )
}

/** Every rule here cost the console something once; see docs/agents/design-system.md. */
describe("design system", () => {
  it("sets text in one family", () => {
    // The console carried a second family for a while and it bought nothing:
    // tabular-nums is what aligns the numbers, and Roboto Mono has no CJK, so
    // every Chinese word and every 亿 suffix inside a mono span fell back to a
    // third face mid-string. A `font-mono` here would bring that seam back.
    expect(linesMatching(/font-mono/)).toEqual([])
  })

  it("has no text sizes below the scale's floor", () => {
    // 10px and 11px were three indistinguishable steps doing three jobs.
    expect(linesMatching(/text-\[1[01]px\]/)).toEqual([])
  })

  it("keeps components off the raw palette", () => {
    // Components consume semantic tokens; only index.css names palette steps.
    expect(linesMatching(/var\(--palette-/)).toEqual([])
  })

  it("stays on the three weights", () => {
    // 400 / 500 / 600. At 12-14px a fourth step is not separable, and anything
    // that needs to be louder than 600 needs to be bigger, not heavier.
    expect(
      linesMatching(/font-(thin|extralight|light|bold|extrabold|black)\b/)
    ).toEqual([])
  })

  it("never moves a weight on hover", () => {
    // A variable-font weight change moves glyph widths with it, which would
    // shuffle text under the reader's cursor.
    expect(linesMatching(/hover[^ "]*:font-(medium|semibold|normal)/)).toEqual(
      []
    )
  })

  it("reserves the wordmark face for the wordmark", () => {
    const users = sources
      .filter(([, source]) => source.includes("font-logo"))
      .map(([file]) => file)
    expect(users).toEqual(["./components/app/app-sidebar.tsx"])
  })
})
