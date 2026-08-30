import { describe, expect, it } from "vitest";

import { validBillingPatch } from "../src/api/admin/account-routes.js";

const NOW = Date.UTC(2026, 7, 30, 12);

describe("validBillingPatch", () => {
  it("accepts a complete monthly or annual setting and a complete clear", () => {
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2026, 7, 24), billingCadence: "monthly" }, NOW)).toBe(true);
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2025, 7, 30), billingCadence: "annual" }, NOW)).toBe(true);
    expect(validBillingPatch({ billingAnchorAt: null, billingCadence: null }, NOW)).toBe(true);
  });

  it("rejects incomplete, invalid, future and non-date settings", () => {
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2026, 7, 24) }, NOW)).toBe(false);
    expect(validBillingPatch({ billingCadence: "monthly" }, NOW)).toBe(false);
    expect(validBillingPatch({ billingAnchorAt: null, billingCadence: "monthly" }, NOW)).toBe(false);
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2026, 7, 24), billingCadence: "weekly" }, NOW)).toBe(false);
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2026, 7, 31), billingCadence: "monthly" }, NOW)).toBe(false);
    expect(validBillingPatch({ billingAnchorAt: Date.UTC(2026, 7, 24, 1), billingCadence: "monthly" }, NOW)).toBe(false);
  });
});
