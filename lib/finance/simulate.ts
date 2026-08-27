import { buildCashFlows, type ProjectModel } from "./appraisal";
import { irr, npv, paybackPeriod } from "./math";

/**
 * 蒙特卡洛项目模拟。
 *
 * 设计约束（见 docs/13-AI增强方案.md）：
 * - 数字全部由确定性数学产生；AI 只负责事后解释分布，不参与抽样。
 * - 带种子伪随机：同一项目 + 同一参数 + 同一种子，结果逐字节一致，可审计、可复现。
 * - 收入与成本扰动用对数正态（中位数 = 1，即基准情形），延迟用离散分布。
 */

export interface SimulateOptions {
  /** 迭代次数，默认 1000，上限 10000（API 侧钳制） */
  iterations?: number;
  /** 随机种子，默认 42；相同种子保证结果可复现 */
  seed?: number;
  /** 收入对数正态波动 σ，默认 0.15（约 ±15% 的一 sigma） */
  revenueSigma?: number;
  /** 成本对数正态波动 σ，默认 0.10 */
  costSigma?: number;
  /** 投产延迟发生概率，默认 0.25 */
  delayProbability?: number;
  /** 延迟期数上限（含），默认 2 期；延迟期数在 1..max 间均匀抽取 */
  maxDelayPeriods?: number;
}

export interface DistributionSummary {
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface SimulationResult {
  iterations: number;
  options: Required<SimulateOptions>;
  /** 确定性基准 NPV（无扰动），用于和分布中位数对照 */
  baseNpv: number;
  npv: DistributionSummary;
  /** IRR 中位数；没有任何一次迭代有有效 IRR 时为 null */
  irrMedian: number | null;
  /** NPV < 0 的迭代占比 */
  probNpvNegative: number;
  /** 回收期落在项目周期内的迭代占比 */
  probPaybackWithinPeriods: number;
  /** 平均延迟期数（0 = 从不延迟） */
  expectedDelayPeriods: number;
  /** 破产线：运营期累计现金流跌破初始投入（继续烧钱耗尽资金池）的统计 */
  insolvency: {
    probability: number;
    /** 耗尽发生的期数中位数；从未耗尽时为 null */
    medianPeriod: number | null;
  };
  /** NPV 直方图，约 20 个桶 */
  histogram: HistogramBin[];
}

/** mulberry32：32 位种子 PRNG，短小、确定、可复现。 */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller：从均匀分布生成标准正态。 */
function normal(rng: () => number) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 对数正态缩放因子：中位数为 1，sigma 控制离散度。 */
function logNormalScale(sigma: number, rng: () => number) {
  return Math.exp(normal(rng) * sigma);
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return Number.NaN;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values: number[]): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return {
    mean,
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function buildHistogram(values: number[], binCount = 20): HistogramBin[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    from: min + width * index,
    to: min + width * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index].count += 1;
  }
  return bins;
}

/** 单次抽样：返回扰动后的现金流与实际延迟期数。 */
function sampleCashFlows(
  model: ProjectModel,
  options: Required<SimulateOptions>,
  rng: () => number,
): { flows: number[]; delay: number } {
  const usesManual = !!(model.manualCashFlows?.length || model.datedCashFlows?.length);
  if (usesManual) {
    // 手工/带日期现金流没有经营驱动结构：对 0 期之后的每期乘以对数正态噪声，延迟不适用。
    const base = buildCashFlows(model);
    return {
      flows: base.map((value, index) => (index === 0 ? value : value * logNormalScale(options.revenueSigma, rng))),
      delay: 0,
    };
  }
  const revenueScale = logNormalScale(options.revenueSigma, rng);
  const costScale = logNormalScale(options.costSigma, rng);
  const delay =
    rng() < options.delayProbability ? 1 + Math.floor(rng() * options.maxDelayPeriods) : 0;
  return { flows: buildCashFlows(model, revenueScale, costScale, delay), delay };
}

/** 破产线：累计现金流首次跌破初始投入（资金池耗尽）的期数；从未跌破返回 null。 */
function firstInsolvencyPeriod(flows: number[]): number | null {
  const initial = -flows[0];
  let cumulative = flows[0];
  for (let period = 1; period < flows.length; period += 1) {
    cumulative += flows[period];
    if (cumulative < -initial) return period;
  }
  return null;
}

export function simulateProject(model: ProjectModel, options: SimulateOptions = {}): SimulationResult {
  if (model.inflationMode !== model.discountRateMode) throw new Error("现金流与折现率口径必须一致");
  if (model.periods < 1) throw new Error("项目周期至少为一期");
  const resolved: Required<SimulateOptions> = {
    iterations: options.iterations ?? 1000,
    seed: options.seed ?? 42,
    revenueSigma: options.revenueSigma ?? 0.15,
    costSigma: options.costSigma ?? 0.1,
    delayProbability: options.delayProbability ?? 0.25,
    maxDelayPeriods: options.maxDelayPeriods ?? 2,
  };
  if (resolved.iterations < 1 || !Number.isInteger(resolved.iterations)) throw new Error("迭代次数必须为正整数");
  if (resolved.revenueSigma < 0 || resolved.costSigma < 0) throw new Error("波动率不能为负");

  const rng = mulberry32(resolved.seed);
  const npvValues: number[] = [];
  const irrValues: number[] = [];
  const insolvencyPeriods: number[] = [];
  let negativeCount = 0;
  let paybackCount = 0;
  let delayTotal = 0;

  for (let iteration = 0; iteration < resolved.iterations; iteration += 1) {
    const { flows, delay } = sampleCashFlows(model, resolved, rng);
    delayTotal += delay;
    const value = npv(model.discountRate, flows);
    npvValues.push(value);
    if (value < 0) negativeCount += 1;
    const payback = paybackPeriod(flows);
    if (payback !== null && payback <= model.periods) paybackCount += 1;
    const rate = irr(flows);
    if (rate !== null) irrValues.push(rate);
    const insolvencyPeriod = firstInsolvencyPeriod(flows);
    if (insolvencyPeriod !== null) insolvencyPeriods.push(insolvencyPeriod);
  }

  const irrSorted = [...irrValues].sort((a, b) => a - b);
  const insolvencySorted = [...insolvencyPeriods].sort((a, b) => a - b);

  return {
    iterations: resolved.iterations,
    options: resolved,
    baseNpv: npv(model.discountRate, buildCashFlows(model)),
    npv: summarize(npvValues),
    irrMedian: irrSorted.length ? percentile(irrSorted, 0.5) : null,
    probNpvNegative: negativeCount / resolved.iterations,
    probPaybackWithinPeriods: paybackCount / resolved.iterations,
    expectedDelayPeriods: delayTotal / resolved.iterations,
    insolvency: {
      probability: insolvencyPeriods.length / resolved.iterations,
      medianPeriod: insolvencySorted.length ? percentile(insolvencySorted, 0.5) : null,
    },
    histogram: buildHistogram(npvValues),
  };
}
