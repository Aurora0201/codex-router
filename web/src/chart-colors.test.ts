import { describe, expect, it } from "vitest"
import css from "./index.css?raw"

function token(block: string, name: string): string {
  const value = block.match(new RegExp(name + ": ([^;]+);"))?.[1]
  if (!value) throw new Error("Missing color token: " + name)
  return value
}

// OKLCH -> linear sRGB -> relative luminance. Keep contrast regression
// independent of jsdom's incomplete CSS color/computed-style support.
function luminance(color: string): number {
  const values = color.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!values) throw new Error("Expected opaque OKLCH: " + color)
  const [, lightness, chroma, hue] = values.map(Number)
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * blue
}

describe("emphasis chart colors", () => {
  const light = css.split(":root {")[1].split(".dark {")[0]
  const dark = css.split(".dark {")[1]

  it("keeps the existing light-theme chart colors", () => {
    for (const step of [1, 3, 5]) {
      expect(token(light, "--emphasis-chart-" + step)).toBe(
        "var(--chart-" + step + ")"
      )
    }
  })

  it("separates all dark-theme bars from the emphasis inset", () => {
    const background = luminance(token(dark, "--emphasis-surface"))
    const series = [1, 3, 5].map((step) =>
      luminance(token(dark, "--emphasis-chart-" + step))
    )
    for (const value of series) {
      expect((value + 0.05) / (background + 0.05)).toBeGreaterThanOrEqual(3)
    }
    expect(series[1]).toBeGreaterThan(series[0])
    expect(series[2]).toBeGreaterThan(series[1])
  })
})
