import { describe, expect, it } from "vitest";
import { buildDecisionRecord, evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";
import { cashFlowsToCsv, decisionRecordToMarkdown, parseCashFlowCsv, projectToJson } from "@/lib/report/export";

const model: ProjectModel = {
  name: "示例服务项目",
  currency: "CNY",
  periods: 2,
  discountRate: 0.1,
  stretchReturnRate: 0.18,
  inflationMode: "nominal",
  discountRateMode: "nominal",
  revenue: { prospects: 100, conversionRate: 0.2, averageTicket: 1000, frequency: 2, annualGrowth: 0 },
  variableCostRate: 0.2,
  annualFixedOperatingCost: 5000,
  taxRate: 0.2,
  necessaryStartupCost: 10000,
  minimumOperatingCost: 5000,
  workingCapital: 2000,
  riskContingency: 1000,
  terminalValue: 0,
  sunkCost: 3000,
  assumptions: [{ name: "价格", value: "1000", status: "known", confidence: "high", source: "报价", asOf: "2026-08-20" }],
  hiddenCosts: [],
};

describe("report exports", () => {
  it("renders the fixed audit sections as Markdown", () => {
    const evaluation = evaluateProject(model);
    const markdown = decisionRecordToMarkdown(model, evaluation, buildDecisionRecord(model, evaluation));
    expect(markdown).toContain("# 示例服务项目｜决策审计记录");
    expect(markdown).toContain("## 6. 逐期现金流与公式");
    expect(markdown).toContain("## 10. 反证与失败条件");
    expect(markdown).toContain("本报告不构成投资、税务或法律建议");
  });

  it("round-trips cash flows through CSV", () => {
    const csv = cashFlowsToCsv([-1000, 600, 600]);
    expect(csv).toBe("period,amount\n0,-1000\n1,600\n2,600");
    expect(parseCashFlowCsv(csv)).toEqual([-1000, 600, 600]);
  });

  it("exports a versioned JSON project payload", () => {
    expect(JSON.parse(projectToJson(model))).toMatchObject({ version: 1, project: { name: "示例服务项目" } });
  });
});
