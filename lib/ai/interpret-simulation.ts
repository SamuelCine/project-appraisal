import type { AIMessage } from "./provider";
import type { SimulationResult } from "@/lib/finance/simulate";

/**
 * 蒙特卡洛分布的"翻译层"：
 * - buildRuleNarrative 是确定性模板，无 AI 时的兜底解读；
 * - buildSimulationMessages 把分布 JSON 喂给模型，提示词明确禁止 AI 发明数字。
 */

function money(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    notation: Math.abs(value) > 999999 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

/** 规则模式解读：只读分布数字，不引入任何外部信息，输出与 AI 版同结构的三段。 */
export function buildRuleNarrative(simulation: SimulationResult, currency: string): string {
  const { npv, probNpvNegative, probPaybackWithinPeriods, baseNpv, insolvency, iterations } = simulation;
  const spread = npv.p90 - npv.p10;
  const lines: string[] = [];

  lines.push(
    `时间线与回报分布（${iterations} 次模拟）：NPV 中位数 ${money(npv.p50, currency)}，` +
      `80% 区间 ${money(npv.p10, currency)} ~ ${money(npv.p90, currency)}，` +
      `基准确定性 NPV ${money(baseNpv, currency)}${npv.p50 < baseNpv ? "，中位数低于基准，说明扰动下结果分布偏左（延迟与成本超支的伤害大于收入超预期的帮助）" : "，中位数与基准基本一致"}。`,
  );

  lines.push(
    `风险：NPV 转负概率 ${percent(probNpvNegative)}，项目周期内完成回收概率 ${percent(probPaybackWithinPeriods)}，` +
      (insolvency.probability > 0
        ? `资金耗尽（破产线）概率 ${percent(insolvency.probability)}${insolvency.medianPeriod !== null ? `，中位发生在第 ${insolvency.medianPeriod.toFixed(1)} 期` : ""}。`
        : "未出现资金耗尽情形。"),
  );

  const advice: string[] = [];
  if (probNpvNegative > 0.4) advice.push("亏损概率偏高，应缩小最低可行规模或先验证收入假设再投入");
  else if (probNpvNegative > 0.15) advice.push("亏损概率中等，建议按 P10 情形准备资金缓冲");
  else advice.push("分布对扰动稳健，主要风险不在抽样波动内");
  if (insolvency.probability > 0.1) advice.push("破产线概率不可忽视，投产延迟期的固定成本需要有专项现金储备");
  if (spread > Math.abs(npv.p50)) advice.push("分布宽度超过中位数本身，关键假设的微小偏差就足以改变结论，优先补证据");
  lines.push(`建议：${advice.join("；")}。`);

  lines.push("（本解读由规则模板生成；连接本地 Ollama 或配置云端模型后可获得结合项目上下文的多模态解读，数字不会因此改变。）");
  return lines.join("\n\n");
}

/** AI 解读的提示词：分布数字全部在输入里，模型只许引用、不许计算新数字。 */
export function buildSimulationMessages(projectName: string, currency: string, simulation: SimulationResult): AIMessage[] {
  const payload = {
    项目: projectName,
    币种: currency,
    模拟次数: simulation.iterations,
    基准NPV: Math.round(simulation.baseNpv),
    NPV分布: {
      P10: Math.round(simulation.npv.p10),
      P25: Math.round(simulation.npv.p25),
      P50: Math.round(simulation.npv.p50),
      P75: Math.round(simulation.npv.p75),
      P90: Math.round(simulation.npv.p90),
    },
    NPV转负概率: percent(simulation.probNpvNegative),
    周期内回收概率: percent(simulation.probPaybackWithinPeriods),
    平均延迟期数: Number(simulation.expectedDelayPeriods.toFixed(2)),
    资金耗尽概率: percent(simulation.insolvency.probability),
    资金耗尽中位期: simulation.insolvency.medianPeriod,
    IRR中位数: simulation.irrMedian === null ? null : percent(simulation.irrMedian),
  };
  return [
    {
      role: "system",
      content:
        "你是项目评估解读员。规则：1) 只能引用输入 JSON 中出现的数字，禁止计算或估算任何新数字；" +
        "2) 用简体中文输出三段：时间线与回报分布、风险、建议，每段不超过三句话；" +
        "3) 不使用 Markdown 标题，不使用夸张措辞；4) 不评价输入之外的信息。",
    },
    {
      role: "user",
      content: `请解读以下蒙特卡洛模拟分布：\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}
