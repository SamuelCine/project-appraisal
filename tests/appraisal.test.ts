import { describe, expect, it } from "vitest";
import {
  buildDecisionRecord,
  calculateReverseValuation,
  evaluateProject,
  type ProjectModel,
} from "@/lib/finance/appraisal";

const project: ProjectModel = {
  name: "社区咖啡订阅",
  currency: "CNY",
  periods: 3,
  discountRate: 0.1,
  stretchReturnRate: 0.2,
  inflationMode: "nominal",
  discountRateMode: "nominal",
  revenue: {
    prospects: 1000,
    conversionRate: 0.2,
    averageTicket: 100,
    frequency: 12,
    annualGrowth: 0.05,
  },
  variableCostRate: 0.35,
  annualFixedOperatingCost: 80000,
  taxRate: 0.2,
  necessaryStartupCost: 120000,
  minimumOperatingCost: 30000,
  workingCapital: 20000,
  riskContingency: 10000,
  terminalValue: 20000,
  sunkCost: 15000,
  assumptions: [
    { name: "转化率", value: "20%", status: "estimated", confidence: "medium", source: "访谈", asOf: "2026-08-20" },
  ],
  hiddenCosts: [{ name: "创始人时间", amount: 24000, included: false, category: "机会成本" }],
};

describe("project appraisal", () => {
  it("builds incremental cash flow without including sunk cost", () => {
    const result = evaluateProject(project);
    expect(result.cashFlows[0]).toBe(-180000);
    expect(result.cashFlows).toHaveLength(4);
    expect(result.metrics.npv).toBeGreaterThan(0);
    expect(result.warnings).toContain("有 1 项隐藏成本尚未计入");
  });

  it("adds confirmed hidden costs to the investment cash flow", () => {
    const result = evaluateProject({
      ...project,
      hiddenCosts: [{ name: "创始人时间", amount: 24000, included: true, category: "机会成本" }],
    });
    expect(result.cashFlows[0]).toBe(-204000);
  });

  it("blocks a real/nominal mismatch", () => {
    expect(() => evaluateProject({ ...project, discountRateMode: "real" })).toThrow("现金流与折现率口径必须一致");
  });

  it("reverse values one million received in year three", () => {
    const result = calculateReverseValuation({
      futureCashFlows: [{ period: 3, amount: 1_000_000 }],
      minimumHurdleRate: 0.1,
      stretchReturnRate: 0.2,
      necessaryStartupCost: 400000,
      minimumOperatingCost: 100000,
      workingCapital: 50000,
      riskContingency: 50000,
      equityShare: 1,
    });
    expect(result.valueCeiling).toBeCloseTo(751314.8, 1);
    expect(result.negotiationFloor).toBeCloseTo(578703.7, 1);
    expect(result.minimumViableInvestment).toBe(600000);
    expect(result.safetyMargin).toBeCloseTo(151314.8, 1);
    expect(result.feasible).toBe(true);
  });

  it("marks the project infeasible when the operating floor exceeds value", () => {
    const result = calculateReverseValuation({
      futureCashFlows: [{ period: 3, amount: 1_000_000 }],
      minimumHurdleRate: 0.1,
      stretchReturnRate: 0.2,
      necessaryStartupCost: 800000,
      minimumOperatingCost: 100000,
      workingCapital: 50000,
      riskContingency: 50000,
      equityShare: 1,
    });
    expect(result.feasible).toBe(false);
  });

  it("produces an auditable record with assumptions and failure conditions", () => {
    const evaluation = evaluateProject(project);
    const record = buildDecisionRecord(project, evaluation);
    expect(record.framework).toContain("增量现金流");
    expect(record.inputs.estimated).toContain("转化率：20%");
    expect(record.hiddenCosts).toContain("创始人时间（机会成本）：¥24,000 未计入");
    expect(record.failureConditions.length).toBeGreaterThan(0);
    expect(record.nextActions).toContain("验证并决定是否计入：创始人时间");
  });
});
