import { afterEach, describe, expect, it } from "vitest";
import { completeWithFallback, getAIStatus, resetAIStatusCache } from "@/lib/ai/provider";
import { buildRuleNarrative, buildSimulationMessages } from "@/lib/ai/interpret-simulation";
import { defaultProject } from "@/lib/finance/default-project";
import { simulateProject } from "@/lib/finance/simulate";

// 测试环境必须确定性降级：把 Ollama 指向不可达地址、删掉云端 Key，
// 避免宿主机真实运行的 Ollama 或环境变量干扰"规则模式"断言。
// 端口 9（discard）按惯例无服务监听，连接会被立即拒绝。
const ORIGINAL_ENV = { ...process.env };

function forceNoAI() {
  process.env.AI_PROVIDER = "auto";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
  delete process.env.OPENAI_API_KEY;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetAIStatusCache();
});

describe("AI provider 降级行为", () => {
  it("无可用模型时状态为规则模式，且给出说明", async () => {
    forceNoAI();
    const status = await getAIStatus(true);
    expect(status.mode).toBe("rules");
    expect(status.provider).toBeNull();
    expect(status.detail).toContain("规则模式");
  });

  it("completeWithFallback 在 AI 不可用时返回规则文本并标记来源", async () => {
    forceNoAI();
    const result = await completeWithFallback(
      [{ role: "user", content: "不会送达的请求" }],
      () => "规则模板输出",
    );
    expect(result.text).toBe("规则模板输出");
    expect(result.source).toBe("rules");
  });

  it("getAIStatus 在 60 秒缓存窗口内复用探测结果", async () => {
    forceNoAI();
    const first = await getAIStatus(true);
    const second = await getAIStatus();
    expect(second).toBe(first);
  });
});

describe("模拟解读层", () => {
  const simulation = simulateProject(defaultProject, { iterations: 200, seed: 3 });

  it("规则解读引用分布数字且不产生 NaN/undefined", () => {
    const text = buildRuleNarrative(simulation, "CNY");
    expect(text).toContain("时间线与回报分布");
    expect(text).toContain("风险");
    expect(text).toContain("建议");
    expect(text).not.toMatch(/NaN|undefined/);
    expect(text).toContain(`${(simulation.probNpvNegative * 100).toFixed(1)}%`);
  });

  it("AI 提示词把全部分布数字放进输入并禁止模型发明数字", () => {
    const messages = buildSimulationMessages(defaultProject.name, "CNY", simulation);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("只能引用输入 JSON 中出现的数字");
    const payload = JSON.parse(messages[1].content.replace(/^[\s\S]*?(\{[\s\S]*\})$/, "$1"));
    expect(payload.NPV分布.P50).toBe(Math.round(simulation.npv.p50));
    expect(payload.模拟次数).toBe(200);
  });
});
