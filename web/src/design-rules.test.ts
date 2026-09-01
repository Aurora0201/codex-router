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

/** Every rule here cost the console something once; see docs/agents/design-system.md. */
describe("design system", () => {
  it("only sets the monospace face behind isMachineText", () => {
    // Roboto Mono has no CJK, so a slot that hardcodes font-mono splits any
    // Chinese word or CJK-suffixed number across two faces. The face is a
    // question about the value, and only the value can answer it.
    const offenders = sources.flatMap(([file, source]) =>
      source
        .split("\n")
        .flatMap((line, index) =>
          line.includes("font-mono") && !line.includes("isMachineText")
            ? [`${file}:${index + 1}`]
            : []
        )
    )
    expect(offenders).toEqual([])
  })

  it("has no text sizes below the scale's floor", () => {
    // 10px and 11px were three indistinguishable steps doing three jobs.
    const offenders = sources
      .filter(([, source]) => /text-\[1[01]px\]/.test(source))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it("keeps components off the raw palette", () => {
    // Components consume semantic tokens; only index.css names palette steps.
    const offenders = sources
      .filter(([, source]) => source.includes("var(--palette-"))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it("reserves the wordmark face for the wordmark", () => {
    const users = sources
      .filter(([, source]) => source.includes("font-logo"))
      .map(([file]) => file)
    expect(users).toEqual(["./components/app/app-sidebar.tsx"])
  })
})
