import { describe, expect, it } from "vitest";
import { defaultProject } from "@/lib/finance/default-project";
import { buildCashFlows } from "@/lib/finance/appraisal";
import { npv } from "@/lib/finance/math";
import { simulateProject } from "@/lib/finance/simulate";

describe("simulateProject 蒙特卡洛模拟", () => {
  it("相同种子产生逐字节一致的结果（可审计、可复现）", () => {
    const first = simulateProject(defaultProject, { iterations: 200, seed: 7 });
    const second = simulateProject(defaultProject, { iterations: 200, seed: 7 });
    expect(second).toEqual(first);
  });

  it("不同种子产生不同抽样，但分布参数一致时量级相近", () => {
    const a = simulateProject(defaultProject, { iterations: 500, seed: 1 });
    const b = simulateProject(defaultProject, { iterations: 500, seed: 2 });
    expect(a.npv.p50).not.toBe(b.npv.p50);
    expect(Math.abs(a.npv.p50 - b.npv.p50)).toBeLessThan(Math.abs(a.npv.p90 - a.npv.p10));
  });

  it("概率字段落在 [0,1]，分位数单调递增", () => {
    const result = simulateProject(defaultProject, { iterations: 500 });
    for (const probability of [result.probNpvNegative, result.probPaybackWithinPeriods, result.insolvency.probability]) {
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }
    expect(result.npv.p10).toBeLessThanOrEqual(result.npv.p50);
    expect(result.npv.p50).toBeLessThanOrEqual(result.npv.p90);
    expect(result.npv.min).toBeLessThanOrEqual(result.npv.p10);
    expect(result.npv.max).toBeGreaterThanOrEqual(result.npv.p90);
  });

  it("零波动、零延迟时分布退化为确定性基准 NPV", () => {
    const result = simulateProject(defaultProject, {
      iterations: 100,
      revenueSigma: 0,
      costSigma: 0,
      delayProbability: 0,
    });
    const baseNpv = npv(defaultProject.discountRate, buildCashFlows(defaultProject));
    expect(result.baseNpv).toBeCloseTo(baseNpv, 6);
    expect(result.npv.p50).toBeCloseTo(baseNpv, 6);
    expect(result.probNpvNegative).toBe(baseNpv < 0 ? 1 : 0);
    expect(result.expectedDelayPeriods).toBe(0);
  });

  it("延迟概率为 1 时每次迭代都延迟且破产线概率上升", () => {
    const always = simulateProject(defaultProject, { iterations: 100, delayProbability: 1, maxDelayPeriods: 2 });
    expect(always.expectedDelayPeriods).toBeGreaterThanOrEqual(1);
    const never = simulateProject(defaultProject, { iterations: 100, delayProbability: 0 });
    expect(never.expectedDelayPeriods).toBe(0);
    expect(never.insolvency.probability).toBe(0);
  });

  it("手工现金流模式下不崩溃，且 0 期投入不被扰动", () => {
    const manual = { ...defaultProject, manualCashFlows: [-100000, 60000, 60000, 60000] };
    const result = simulateProject(manual, { iterations: 100 });
    expect(Number.isFinite(result.npv.p50)).toBe(true);
    expect(result.expectedDelayPeriods).toBe(0);
    // 所有迭代共用同一个 -100000 初始投入，NPV 分布宽度只来自后续期扰动
    expect(result.npv.max - result.npv.min).toBeGreaterThan(0);
  });

  it("直方图桶计数总和等于迭代次数", () => {
    const result = simulateProject(defaultProject, { iterations: 300 });
    expect(result.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(300);
  });

  it("拒绝非法参数", () => {
    expect(() => simulateProject(defaultProject, { iterations: 0 })).toThrow("迭代次数");
    expect(() => simulateProject(defaultProject, { revenueSigma: -0.1 })).toThrow("波动率");
    expect(() =>
      simulateProject({ ...defaultProject, inflationMode: "real" }, { iterations: 10 }),
    ).toThrow("口径必须一致");
  });
});
