import { describe, expect, it } from "vitest";
import { histogramBucketMs } from "../src/db/repositories/request-log-repository.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("histogramBucketMs", () => {
  it("gives every window a cell someone could name", () => {
    // A fixed count of cells made these 37 seconds, 15 minutes and 105
    // minutes respectively — two of the three are spans nobody thinks in.
    expect(histogramBucketMs(HOUR)).toBe(MINUTE);
    expect(histogramBucketMs(24 * HOUR)).toBe(15 * MINUTE);
    expect(histogramBucketMs(7 * DAY)).toBe(2 * HOUR);
  });

  it("keeps the strip short enough to read as a row", () => {
    for (const span of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY, 400 * DAY]) {
      expect(span / histogramBucketMs(span)).toBeLessThanOrEqual(96);
    }
  });

  it("never divides by zero on a window with no width", () => {
    expect(histogramBucketMs(0)).toBe(MINUTE);
    expect(histogramBucketMs(-1)).toBe(MINUTE);
  });
});
