import { describe, expect, it } from "vitest";
import { normalizeProjectModel } from "@/lib/finance/validate";
import { defaultProject } from "@/lib/finance/default-project";

describe("project model validation", () => {
  it("fills missing fields with defaults instead of crashing the engine", () => {
    const model = normalizeProjectModel({ name: "只有名字", currency: "USD" });
    expect(model.name).toBe("只有名字");
    expect(model.currency).toBe("USD");
    expect(model.periods).toBe(defaultProject.periods);
    expect(model.revenue).toEqual(defaultProject.revenue);
    expect(model.assumptions).toEqual([]);
    expect(model.hiddenCosts).toEqual([]);
  });

  it("rejects non-object input and invalid field types with Chinese messages", () => {
    expect(() => normalizeProjectModel(null)).toThrow("项目数据无效");
    expect(() => normalizeProjectModel([1, 2])).toThrow("项目数据无效");
    expect(() => normalizeProjectModel({ discountRate: "abc" })).toThrow("最低可接受回报率 必须是有限数值");
  });

  it("normalizes periods to a positive integer", () => {
    expect(normalizeProjectModel({ periods: 2.7 }).periods).toBe(3);
    expect(normalizeProjectModel({ periods: -5 }).periods).toBe(1);
  });

  it("drops unknown enum values back to safe defaults", () => {
    const model = normalizeProjectModel({
      assumptions: [{ name: "转化率", value: "20%", status: "guessed", confidence: "very-high" }],
    });
    expect(model.assumptions[0].status).toBe("unknown");
    expect(model.assumptions[0].confidence).toBe("low");
  });

  it("validates manual and dated cash flows", () => {
    expect(() => normalizeProjectModel({ manualCashFlows: [-100] })).toThrow("至少需要两期");
    expect(() => normalizeProjectModel({ manualCashFlows: [-100, "x"] })).toThrow("不是有效数值");
    expect(() => normalizeProjectModel({ datedCashFlows: [{ date: "not-a-date", amount: 1 }, { date: "2026-01-01", amount: 2 }] })).toThrow("日期或金额无效");
    expect(() => normalizeProjectModel({
      manualCashFlows: [-100, 200],
      datedCashFlows: [{ date: "2026-01-01", amount: -100 }, { date: "2027-01-01", amount: 200 }],
    })).toThrow("只能二选一");
    const model = normalizeProjectModel({ datedCashFlows: [{ date: "2027-01-01", amount: 200 }, { date: "2026-01-01", amount: -100 }] });
    expect(model.datedCashFlows).toHaveLength(2);
  });
});
