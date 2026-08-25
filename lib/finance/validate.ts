import type { Assumption, HiddenCost, ProjectModel, RevenueDriver, SubscriptionDriver } from "./appraisal";
import { defaultProject } from "./default-project";
import type { DatedCashFlow } from "./math";

/**
 * 输入校验与归一化。
 * API 接收的 JSON 不可信：字段可能缺失、类型可能错误。
 * 这里把任意输入合并到默认模型上，逐项校验类型，
 * 保证进入财务引擎的一定是完整、有限数值的 ProjectModel。
 */

function fail(message: string): never {
  throw new Error(`项目数据无效：${message}`);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} 必须是对象`);
  return value as Record<string, unknown>;
}

function numberOr(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) fail(`${field} 必须是有限数值`);
  return num;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeRevenue(value: unknown): RevenueDriver {
  const raw = value === undefined ? {} : asObject(value, "收益驱动");
  const base = defaultProject.revenue;
  return {
    prospects: numberOr(raw.prospects, base.prospects, "潜在客户数"),
    conversionRate: numberOr(raw.conversionRate, base.conversionRate, "转化率"),
    averageTicket: numberOr(raw.averageTicket, base.averageTicket, "客单价"),
    frequency: numberOr(raw.frequency, base.frequency, "购买频次"),
    annualGrowth: numberOr(raw.annualGrowth, base.annualGrowth, "收入年增长"),
  };
}

function normalizeSubscription(value: unknown): SubscriptionDriver | undefined {
  if (value === undefined || value === null) return defaultProject.subscription;
  const raw = asObject(value, "订阅驱动");
  const base = defaultProject.subscription!;
  return {
    newCustomersPerPeriod: numberOr(raw.newCustomersPerPeriod, base.newCustomersPerPeriod, "每期新增客户"),
    churnRate: numberOr(raw.churnRate, base.churnRate, "流失率"),
    arpu: numberOr(raw.arpu, base.arpu, "ARPU"),
    cac: numberOr(raw.cac, base.cac, "获客成本"),
    serviceCostPerUser: numberOr(raw.serviceCostPerUser, base.serviceCostPerUser, "单客户服务成本"),
  };
}

function normalizeAssumptions(value: unknown): Assumption[] {  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("假设列表必须是数组");
  return value.map((item, index) => {
    const raw = asObject(item, `假设第 ${index + 1} 项`);
    return {
      name: stringOr(raw.name, `假设 ${index + 1}`),
      value: stringOr(raw.value, ""),
      status: oneOf(raw.status, ["known", "estimated", "unknown"] as const, "unknown"),
      confidence: oneOf(raw.confidence, ["high", "medium", "low"] as const, "low"),
      source: stringOr(raw.source, "未记录来源"),
      asOf: stringOr(raw.asOf, new Date().toISOString().slice(0, 10)),
    };
  });
}

function normalizeHiddenCosts(value: unknown): HiddenCost[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("隐藏成本列表必须是数组");
  return value.map((item, index) => {
    const raw = asObject(item, `隐藏成本第 ${index + 1} 项`);
    return {
      name: stringOr(raw.name, `成本 ${index + 1}`),
      amount: numberOr(raw.amount, 0, `隐藏成本「${stringOr(raw.name, `${index + 1}`)}」金额`),
      included: raw.included === true,
      category: stringOr(raw.category, "未分类"),
    };
  });
}

function normalizeManualCashFlows(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail("手工现金流必须是数组");
  const flows = value.map((item, index) => {
    const num = Number(item);
    if (!Number.isFinite(num)) fail(`手工现金流第 ${index + 1} 期不是有效数值`);
    return num;
  });
  if (flows.length > 0 && flows.length < 2) fail("手工现金流至少需要两期");
  return flows.length ? flows : undefined;
}

function normalizeDatedCashFlows(value: unknown): DatedCashFlow[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail("带日期现金流必须是数组");
  const flows = value.map((item, index) => {
    const raw = asObject(item, `带日期现金流第 ${index + 1} 笔`);
    const amount = Number(raw.amount);
    const date = new Date(String(raw.date ?? ""));
    if (!Number.isFinite(amount) || Number.isNaN(date.getTime())) {
      fail(`带日期现金流第 ${index + 1} 笔的日期或金额无效`);
    }
    return { amount, date: date.toISOString().slice(0, 10) };
  });
  if (flows.length > 0 && flows.length < 2) fail("带日期现金流至少需要两笔");
  return flows.length ? flows : undefined;
}

/**
 * 把任意 JSON 输入归一化为完整 ProjectModel。
 * 缺失字段用 defaultProject 补齐；类型错误时抛出中文错误信息。
 */
export function normalizeProjectModel(input: unknown): ProjectModel {
  const raw = asObject(input, "项目");
  const base = defaultProject;
  const model: ProjectModel = {
    name: stringOr(raw.name, base.name),
    currency: stringOr(raw.currency, base.currency),
    periods: Math.max(1, Math.round(numberOr(raw.periods, base.periods, "项目周期"))),
    discountRate: numberOr(raw.discountRate, base.discountRate, "最低可接受回报率"),
    stretchReturnRate: numberOr(raw.stretchReturnRate, base.stretchReturnRate, "目标回报率"),
    inflationMode: oneOf(raw.inflationMode, ["nominal", "real"] as const, base.inflationMode),
    discountRateMode: oneOf(raw.discountRateMode, ["nominal", "real"] as const, base.discountRateMode),
    revenue: normalizeRevenue(raw.revenue),
    revenueModel: oneOf(raw.revenueModel, ["generic", "subscription"] as const, "generic"),
    subscription: normalizeSubscription(raw.subscription),
    role: stringOr(raw.role, base.role ?? "项目经营者"),
    baseline: stringOr(raw.baseline, base.baseline ?? ""),
    schemaVersion: Math.max(1, Math.round(numberOr(raw.schemaVersion, 1, "schemaVersion"))),
    variableCostRate: numberOr(raw.variableCostRate, base.variableCostRate, "变动成本率"),
    annualFixedOperatingCost: numberOr(raw.annualFixedOperatingCost, base.annualFixedOperatingCost, "年固定运营成本"),
    taxRate: numberOr(raw.taxRate, base.taxRate, "税率"),
    necessaryStartupCost: numberOr(raw.necessaryStartupCost, base.necessaryStartupCost, "必要启动成本"),
    minimumOperatingCost: numberOr(raw.minimumOperatingCost, base.minimumOperatingCost, "最低运营成本"),
    workingCapital: numberOr(raw.workingCapital, base.workingCapital, "营运资金"),
    riskContingency: numberOr(raw.riskContingency, base.riskContingency, "风险预备金"),
    terminalValue: numberOr(raw.terminalValue, base.terminalValue, "期末残值"),
    sunkCost: numberOr(raw.sunkCost, base.sunkCost, "沉没成本"),
    assumptions: normalizeAssumptions(raw.assumptions),
    hiddenCosts: normalizeHiddenCosts(raw.hiddenCosts),
    manualCashFlows: normalizeManualCashFlows(raw.manualCashFlows),
    datedCashFlows: normalizeDatedCashFlows(raw.datedCashFlows),
  };
  if (model.manualCashFlows && model.datedCashFlows) {
    fail("手工现金流与带日期现金流只能二选一");
  }
  return model;
}

/** 解析请求体：空 body 返回 null，非法 JSON 抛出统一错误。 */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}
