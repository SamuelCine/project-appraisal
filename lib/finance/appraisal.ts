import {
  discountedPaybackPeriod,
  irr,
  mirr,
  npv,
  paybackPeriod,
  profitabilityIndex,
  signChanges,
} from "./math";

export type AssumptionStatus = "known" | "estimated" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface Assumption {
  name: string;
  value: string;
  status: AssumptionStatus;
  confidence: Confidence;
  source: string;
  asOf: string;
}

export interface HiddenCost {
  name: string;
  amount: number;
  included: boolean;
  category: string;
}

export interface RevenueDriver {
  prospects: number;
  conversionRate: number;
  averageTicket: number;
  frequency: number;
  annualGrowth: number;
}

export interface ProjectModel {
  name: string;
  currency: string;
  periods: number;
  discountRate: number;
  stretchReturnRate: number;
  inflationMode: "nominal" | "real";
  discountRateMode: "nominal" | "real";
  revenue: RevenueDriver;
  variableCostRate: number;
  annualFixedOperatingCost: number;
  taxRate: number;
  necessaryStartupCost: number;
  minimumOperatingCost: number;
  workingCapital: number;
  riskContingency: number;
  terminalValue: number;
  sunkCost: number;
  assumptions: Assumption[];
  hiddenCosts: HiddenCost[];
  manualCashFlows?: number[];
}

export interface ProjectMetrics {
  npv: number;
  irr: number | null;
  mirr: number | null;
  roi: number;
  profitabilityIndex: number;
  paybackPeriod: number | null;
  discountedPaybackPeriod: number | null;
}

export interface ScenarioResult {
  name: "悲观" | "基准" | "乐观";
  npv: number;
  irr: number | null;
  cashFlows: number[];
}

export interface SensitivityPoint {
  variable: string;
  downsideNpv: number;
  upsideNpv: number;
  impact: number;
  switchingValue: string;
}

export interface EvaluationResult {
  cashFlows: number[];
  revenueByPeriod: number[];
  metrics: ProjectMetrics;
  scenarios: ScenarioResult[];
  sensitivity: SensitivityPoint[];
  recommendation: "建议推进" | "满足条件后推进" | "继续验证" | "暂缓" | "拒绝";
  warnings: string[];
}

function currency(amount: number, code: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildCashFlows(model: ProjectModel, revenueScale = 1, costScale = 1, delay = 0) {
  if (model.manualCashFlows?.length) return [...model.manualCashFlows];
  const confirmedHiddenCosts = model.hiddenCosts
    .filter((item) => item.included)
    .reduce((total, item) => total + item.amount, 0);
  const initial =
    model.necessaryStartupCost + model.minimumOperatingCost + model.workingCapital + model.riskContingency + confirmedHiddenCosts;
  const cashFlows = [-initial];
  for (let period = 1; period <= model.periods; period += 1) {
    if (period <= delay) {
      cashFlows.push(-model.annualFixedOperatingCost * costScale);
      continue;
    }
    const operatingPeriod = period - delay - 1;
    const revenue =
      model.revenue.prospects *
      model.revenue.conversionRate *
      model.revenue.averageTicket *
      model.revenue.frequency *
      (1 + model.revenue.annualGrowth) ** operatingPeriod *
      revenueScale;
    const cashOperatingCost = revenue * model.variableCostRate * costScale + model.annualFixedOperatingCost * costScale;
    const taxableIncome = Math.max(0, revenue - cashOperatingCost);
    let freeCashFlow = revenue - cashOperatingCost - taxableIncome * model.taxRate;
    if (period === model.periods) freeCashFlow += model.terminalValue + model.workingCapital;
    cashFlows.push(freeCashFlow);
  }
  return cashFlows;
}

function metricsFor(cashFlows: number[], discountRate: number): ProjectMetrics {
  const totalOutflow = -cashFlows.filter((flow) => flow < 0).reduce((sum, flow) => sum + flow, 0);
  const totalNet = cashFlows.reduce((sum, flow) => sum + flow, 0);
  return {
    npv: npv(discountRate, cashFlows),
    irr: irr(cashFlows),
    mirr: mirr(cashFlows, discountRate, discountRate),
    roi: totalOutflow ? totalNet / totalOutflow : Number.POSITIVE_INFINITY,
    profitabilityIndex: profitabilityIndex(discountRate, cashFlows),
    paybackPeriod: paybackPeriod(cashFlows),
    discountedPaybackPeriod: discountedPaybackPeriod(discountRate, cashFlows),
  };
}

function switchingRevenue(model: ProjectModel) {
  let low = 0;
  let high = 2;
  for (let i = 0; i < 80; i += 1) {
    const middle = (low + high) / 2;
    if (npv(model.discountRate, buildCashFlows(model, middle)) >= 0) high = middle;
    else low = middle;
  }
  return high;
}

export function evaluateProject(model: ProjectModel): EvaluationResult {
  if (model.inflationMode !== model.discountRateMode) throw new Error("现金流与折现率口径必须一致");
  if (model.periods < 1) throw new Error("项目周期至少为一期");
  const cashFlows = buildCashFlows(model);
  const metrics = metricsFor(cashFlows, model.discountRate);
  const scenarioInputs = [
    { name: "悲观" as const, revenue: 0.8, costs: 1.15, rate: model.discountRate + 0.03 },
    { name: "基准" as const, revenue: 1, costs: 1, rate: model.discountRate },
    { name: "乐观" as const, revenue: 1.15, costs: 0.95, rate: Math.max(0, model.discountRate - 0.01) },
  ];
  const scenarios = scenarioInputs.map((scenario) => {
    const flows = buildCashFlows(model, scenario.revenue, scenario.costs);
    return { name: scenario.name, npv: npv(scenario.rate, flows), irr: irr(flows), cashFlows: flows };
  });
  const sensitivityCases = [
    { variable: "收入", down: buildCashFlows(model, 0.9), up: buildCashFlows(model, 1.1) },
    { variable: "成本", down: buildCashFlows(model, 1, 1.1), up: buildCashFlows(model, 1, 0.9) },
    { variable: "进度", down: buildCashFlows(model, 1, 1, 1), up: cashFlows },
  ];
  const revenueSwitch = switchingRevenue(model);
  const sensitivity = sensitivityCases
    .map((item) => {
      const downsideNpv = npv(model.discountRate, item.down);
      const upsideNpv = npv(model.discountRate, item.up);
      return {
        variable: item.variable,
        downsideNpv,
        upsideNpv,
        impact: Math.abs(upsideNpv - downsideNpv),
        switchingValue: item.variable === "收入" ? `基准收入的 ${(revenueSwitch * 100).toFixed(1)}%` : "见情景结果",
      };
    })
    .sort((a, b) => b.impact - a.impact);
  const missingCosts = model.hiddenCosts.filter((item) => !item.included);
  const unknowns = model.assumptions.filter((item) => item.status === "unknown" || item.confidence === "low");
  const warnings = [
    ...(missingCosts.length ? [`有 ${missingCosts.length} 项隐藏成本尚未计入`] : []),
    ...(unknowns.length ? [`有 ${unknowns.length} 项关键假设仍待验证`] : []),
    ...(signChanges(cashFlows) > 1 ? ["现金流多次改变正负号，IRR 可能存在多解；请以 NPV/MIRR 为主"] : []),
  ];
  let recommendation: EvaluationResult["recommendation"];
  if (metrics.npv < 0 && scenarios[2].npv < 0) recommendation = "拒绝";
  else if (metrics.npv < 0) recommendation = "暂缓";
  else if (unknowns.length > 0) recommendation = "继续验证";
  else if (warnings.length > 0 || scenarios[0].npv < 0) recommendation = "满足条件后推进";
  else recommendation = "建议推进";
  const revenueByPeriod = cashFlows.slice(1).map((_, index) =>
    model.revenue.prospects * model.revenue.conversionRate * model.revenue.averageTicket * model.revenue.frequency *
    (1 + model.revenue.annualGrowth) ** index,
  );
  return { cashFlows, revenueByPeriod, metrics, scenarios, sensitivity, recommendation, warnings };
}

export interface ReverseValuationInput {
  futureCashFlows: { period: number; amount: number }[];
  minimumHurdleRate: number;
  stretchReturnRate: number;
  necessaryStartupCost: number;
  minimumOperatingCost: number;
  workingCapital: number;
  riskContingency: number;
  equityShare: number;
  futureFunding?: number;
  debt?: number;
  preferenceAdjustment?: number;
}

export interface ReverseValuationResult {
  minimumViableInvestment: number;
  negotiationFloor: number;
  negotiationCeiling: number;
  valueCeiling: number;
  safetyMargin: number;
  feasible: boolean;
}

function discountedValue(flows: ReverseValuationInput["futureCashFlows"], rate: number) {
  return flows.reduce((total, flow) => total + flow.amount / (1 + rate) ** flow.period, 0);
}

export function calculateReverseValuation(input: ReverseValuationInput): ReverseValuationResult {
  const minimumViableInvestment =
    input.necessaryStartupCost + input.minimumOperatingCost + input.workingCapital + input.riskContingency;
  const adjustments = (input.futureFunding ?? 0) + (input.debt ?? 0) + (input.preferenceAdjustment ?? 0);
  const valueCeiling = Math.max(0, discountedValue(input.futureCashFlows, input.minimumHurdleRate) * input.equityShare - adjustments);
  const negotiationFloor = Math.max(0, discountedValue(input.futureCashFlows, input.stretchReturnRate) * input.equityShare - adjustments);
  return {
    minimumViableInvestment,
    negotiationFloor,
    negotiationCeiling: valueCeiling,
    valueCeiling,
    safetyMargin: valueCeiling - minimumViableInvestment,
    feasible: minimumViableInvestment <= valueCeiling,
  };
}

export interface DecisionRecord {
  question: string;
  framework: string;
  baseline: string;
  alternatives: string[];
  inputs: { known: string[]; estimated: string[]; unknown: string[] };
  hiddenCosts: string[];
  formula: string;
  cashFlowTable: { period: number; amount: number }[];
  scenarios: ScenarioResult[];
  keySensitivity: SensitivityPoint;
  counterEvidence: string[];
  failureConditions: string[];
  recommendation: EvaluationResult["recommendation"];
  nextActions: string[];
}

export function buildDecisionRecord(model: ProjectModel, evaluation: EvaluationResult): DecisionRecord {
  const grouped = (status: AssumptionStatus) =>
    model.assumptions.filter((item) => item.status === status).map((item) => `${item.name}：${item.value}`);
  const missing = model.hiddenCosts.filter((item) => !item.included);
  return {
    question: `是否应按当前条件推进“${model.name}”？`,
    framework: "基准方案比较 + 增量现金流 + NPV/IRR/MIRR + 情景分析 + 敏感性与临界值",
    baseline: "不做项目：保留资金及现有资源的下一最佳用途",
    alternatives: ["缩小最低可行规模", "延后投资并先验证关键假设"],
    inputs: { known: grouped("known"), estimated: grouped("estimated"), unknown: grouped("unknown") },
    hiddenCosts: model.hiddenCosts.map(
      (item) => `${item.name}（${item.category}）：${currency(item.amount, model.currency)} ${item.included ? "已计入" : "未计入"}`,
    ),
    formula: "自由现金流 = 收入 − 现金运营成本 − 税费 − 资本开支 − 营运资金增加 + 税后残值",
    cashFlowTable: evaluation.cashFlows.map((amount, period) => ({ period, amount })),
    scenarios: evaluation.scenarios,
    keySensitivity: evaluation.sensitivity[0],
    counterEvidence: missing.map((item) => `${item.name}尚未进入模型，当前收益可能被高估`),
    failureConditions: [
      `收入低于${evaluation.sensitivity.find((item) => item.variable === "收入")?.switchingValue ?? "临界值"}`,
      `折现率高于${((evaluation.metrics.irr ?? model.discountRate) * 100).toFixed(1)}%时 NPV 将不再为正`,
    ],
    recommendation: evaluation.recommendation,
    nextActions: missing.map((item) => `验证并决定是否计入：${item.name}`),
  };
}
