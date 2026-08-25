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

  it("provides break-even from operating drivers", () => {
    const result = evaluateProject(project);
    expect(result.breakEven).not.toBeNull();
    // 固定成本 80000 / (客单价 100 − 单位变动成本 35) ≈ 1230.77 单
    expect(result.breakEven?.units).toBeCloseTo(80000 / 65, 4);
  });

  it("uses manual cash flows and suppresses driver-based revenue", () => {
    const result = evaluateProject({ ...project, manualCashFlows: [-100000, 60000, 60000] });
    expect(result.cashFlows).toEqual([-100000, 60000, 60000]);
    expect(result.revenueByPeriod).toEqual([]);
    expect(result.usesManualCashFlows).toBe(true);
    expect(result.breakEven).toBeNull();
    expect(result.warnings).toContain("正在使用手工现金流，经营驱动参数不参与本次计算");
  });

  it("computes XNPV and XIRR for dated cash flows", () => {
    const result = evaluateProject({
      ...project,
      datedCashFlows: [
        { date: "2027-01-01", amount: 1100 },
        { date: "2026-01-01", amount: -1000 },
      ],
    });
    expect(result.metrics.xnpv).toBeCloseTo(0, 6);
    expect(result.metrics.xirr).toBeCloseTo(0.1, 5);
    // 无日期现金流时 XNPV/XIRR 应为空
    expect(evaluateProject(project).metrics.xnpv).toBeNull();
  });

  it("reports when no revenue level within 200% can break even", () => {
    const result = evaluateProject({
      ...project,
      revenue: { prospects: 10, conversionRate: 0.01, averageTicket: 10, frequency: 1, annualGrowth: 0 },
      annualFixedOperatingCost: 500000,
    });
    const revenue = result.sensitivity.find((item) => item.variable === "收入");
    expect(revenue?.switchingValue).toBe("收入达到基准的 200% 仍无法转正，方案需重构");
  });

  it("includes discount-rate sensitivity tied to IRR", () => {
    const result = evaluateProject(project);
    const rate = result.sensitivity.find((item) => item.variable === "折现率");
    expect(rate).toBeDefined();
    expect(rate?.switchingValue).toContain("IRR");
    // 折现率升高 2 个点，NPV 必然下降
    expect(rate!.downsideNpv).toBeLessThan(result.metrics.npv);
  });

  it("drives revenue with the subscription model including churn and CAC", () => {
    const result = evaluateProject({
      ...project,
      revenueModel: "subscription",
      subscription: { newCustomersPerPeriod: 100, churnRate: 0.1, arpu: 1000, cac: 200, serviceCostPerUser: 100 },
      annualFixedOperatingCost: 0,
      taxRate: 0,
    });
    // 第一期：100 客户 × 1000 = 100,000 收入；成本 = 100×100 + 100×200 = 30,000
    expect(result.revenueByPeriod[0]).toBe(100000);
    expect(result.cashFlows[1]).toBe(70000);
    // 第二期客户数：100 × 0.9 + 100 = 190
    expect(result.revenueByPeriod[1]).toBe(190000);
  });

  it("carries role and baseline into the decision record", () => {
    const custom = { ...project, role: "财务出资人", baseline: "资金转投指数基金" };
    const record = buildDecisionRecord(custom, evaluateProject(custom));
    expect(record.question).toContain("财务出资人");
    expect(record.baseline).toBe("资金转投指数基金");
    // 未填写时回退默认文案
    const fallback = buildDecisionRecord(project, evaluateProject(project));
    expect(fallback.baseline).toContain("下一最佳用途");
  });
});
