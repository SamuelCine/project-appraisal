import type { ProjectModel } from "./appraisal";

export const defaultProject: ProjectModel = {
  name: "社区咖啡订阅计划",
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
    annualGrowth: 0.08,
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
    { name: "目标客群规模", value: "1000 人", status: "known", confidence: "high", source: "门店会员数据", asOf: "2026-08-20" },
    { name: "首年转化率", value: "20%", status: "estimated", confidence: "medium", source: "同类活动访谈", asOf: "2026-08-20" },
    { name: "年增长率", value: "8%", status: "unknown", confidence: "low", source: "待小规模测试", asOf: "2026-08-20" },
  ],
  hiddenCosts: [
    { name: "创始人投入时间", amount: 24000, included: false, category: "机会成本" },
    { name: "食品经营许可", amount: 6000, included: true, category: "合规" },
    { name: "设备停机预备", amount: 8000, included: false, category: "风险成本" },
    { name: "合同终止与清理", amount: 5000, included: false, category: "退出成本" },
  ],
};
