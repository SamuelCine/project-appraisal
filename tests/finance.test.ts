import { describe, expect, it } from "vitest";
import {
  breakEven,
  discountedPaybackPeriod,
  irr,
  mirr,
  npv,
  paybackPeriod,
  profitabilityIndex,
  xirr,
  xnpv,
} from "@/lib/finance/math";

describe("finance math", () => {
  it("discounts each cash flow to its period", () => {
    expect(npv(0.1, [-1000, 600, 600])).toBeCloseTo(41.3223, 4);
  });

  it("uses actual dates for XNPV", () => {
    expect(xnpv(0.1, [
      { amount: -1000, date: "2026-01-01" },
      { amount: 1100, date: "2027-01-01" },
    ])).toBeCloseTo(0, 6);
  });

  it("finds IRR and XIRR from cash flows", () => {
    expect(irr([-1000, 600, 600])).toBeCloseTo(0.130662, 5);
    expect(xirr([
      { amount: -1000, date: "2026-01-01" },
      { amount: 1100, date: "2027-01-01" },
    ])).toBeCloseTo(0.1, 5);
  });

  it("returns a single MIRR for non-conventional cash flows", () => {
    expect(mirr([-1000, 1400, -100, 300], 0.08, 0.1)).toBeCloseTo(0.22462, 4);
  });

  it("calculates simple and discounted payback with interpolation", () => {
    expect(paybackPeriod([-1000, 400, 400, 400])).toBe(2.5);
    expect(discountedPaybackPeriod(0.1, [-1000, 500, 500, 500])).toBeCloseTo(2.35, 2);
  });

  it("calculates profitability index and break-even", () => {
    expect(profitabilityIndex(0.1, [-1000, 600, 600])).toBeCloseTo(1.041322, 5);
    expect(breakEven(10000, 20, 50)).toEqual({ units: 333.3333333333333, revenue: 16666.666666666664 });
  });

  it("rejects invalid rates and impossible break-even inputs", () => {
    expect(() => npv(-1, [-1, 2])).toThrow("折现率必须大于 -100%");
    expect(() => breakEven(100, 50, 50)).toThrow("售价必须高于单位变动成本");
  });
});
