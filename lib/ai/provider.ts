/**
 * AI 模型接入抽象（见 docs/13-AI增强方案.md 第 2 节）。
 *
 * 三条边界在此落地：
 * 1. AI 不碰数学——本模块只负责"把结构化结果翻译成人话"，不产生任何数字。
 * 2. 一切可审计——每次调用记录 provider:model 来源，调用方负责持久化。
 * 3. 本地优先——默认 Ollama（127.0.0.1:11434），云端 OpenAI 兼容接口是可选项，
 *    Key 只读 process.env，永不进 Git；两者都不可用时降级为规则模式。
 *
 * 环境变量：
 * - AI_PROVIDER：ollama | openai | auto（默认 auto，按顺序探测）
 * - OLLAMA_BASE_URL / OLLAMA_MODEL（默认 http://127.0.0.1:11434 / qwen2.5:7b）
 * - OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL（默认 https://api.openai.com/v1 / gpt-4o-mini）
 */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** 单次调用超时（毫秒），默认 120000——本地 27B 级模型生成数百 token 需要这个量级 */
  timeoutMs?: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** 探测 provider 是否可用；必须快速失败（秒级），不得长时间挂起 */
  available(): Promise<boolean>;
  complete(messages: AIMessage[], options?: AICompleteOptions): Promise<string>;
}

function timeoutSignal(timeoutMs: number) {
  return AbortSignal.timeout(timeoutMs);
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => "");
  return text.slice(0, 200);
}

class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private resolvedModel: string;
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.resolvedModel = model;
  }

  get model() {
    return this.resolvedModel;
  }

  async available() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: timeoutSignal(2000) });
      if (!response.ok) return false;
      const body = (await response.json()) as { models?: { name?: string }[] };
      const names = (body.models ?? []).map((item) => item.name).filter((name): name is string => !!name);
      if (names.length === 0) return false;
      // 配置的模型不存在时自动切换到本机已安装模型：优先精确匹配，其次同族前缀，最后列表第一项。
      if (!names.includes(this.resolvedModel)) {
        const family = this.resolvedModel.split(":")[0];
        this.resolvedModel = names.find((name) => name.startsWith(family)) ?? names[0];
      }
      return true;
    } catch {
      return false;
    }
  }

  async complete(messages: AIMessage[], options: AICompleteOptions = {}) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        // 关闭思考链：解读任务不需要推理过程；思考型模型（qwen3 等）若不关闭，
        // thinking 会吃光 num_predict 额度导致 content 为空，且慢 3-10 倍。
        think: false,
        options: {
          temperature: options.temperature ?? 0.2,
          ...(options.maxTokens ? { num_predict: options.maxTokens } : {}),
        },
      }),
      signal: timeoutSignal(options.timeoutMs ?? 120000),
    });
    if (!response.ok) throw new Error(`Ollama 调用失败（${response.status}）：${await readErrorBody(response)}`);
    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content?.trim();
    if (!content) throw new Error("Ollama 返回了空内容");
    return content;
  }
}

class OpenAICompatProvider implements AIProvider {
  readonly name = "openai-compat";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(
    baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  // 不每次 ping /models：有 Key 即视为可用，真实失败由 complete 抛出并触发降级。
  async available() {
    return Promise.resolve(!!this.apiKey);
  }

  async complete(messages: AIMessage[], options: AICompleteOptions = {}) {
    if (!this.apiKey) throw new Error("未配置 OPENAI_API_KEY");
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.2,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal: timeoutSignal(options.timeoutMs ?? 120000),
    });
    if (!response.ok) throw new Error(`OpenAI 兼容接口调用失败（${response.status}）：${await readErrorBody(response)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("OpenAI 兼容接口返回了空内容");
    return content;
  }
}

export interface AIStatus {
  mode: "ai" | "rules";
  provider: string | null;
  model: string | null;
  detail: string;
}

function candidateProviders(): AIProvider[] {
  const preference = (process.env.AI_PROVIDER ?? "auto").toLowerCase();
  const candidates: AIProvider[] = [];
  if (preference === "ollama" || preference === "auto") candidates.push(new OllamaProvider());
  if (preference === "openai" || preference === "auto") candidates.push(new OpenAICompatProvider());
  return candidates;
}

/** 按优先级探测并返回第一个可用的 provider；全部不可用返回 null（规则模式）。 */
export async function resolveProvider(): Promise<AIProvider | null> {
  for (const provider of candidateProviders()) {
    try {
      if (await provider.available()) return provider;
    } catch {
      // 探测失败视为不可用，继续下一个
    }
  }
  return null;
}

let statusCache: { at: number; status: AIStatus } | undefined;
const STATUS_CACHE_MS = 60_000;

/** AI 接入状态，60 秒缓存避免每次请求都探测本地端口。 */
export async function getAIStatus(forceRefresh = false): Promise<AIStatus> {
  if (!forceRefresh && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.status;
  const provider = await resolveProvider();
  const status: AIStatus = provider
    ? { mode: "ai", provider: provider.name, model: provider.model, detail: `已连接 ${provider.name}（模型 ${provider.model}）` }
    : { mode: "rules", provider: null, model: null, detail: "未检测到可用 AI 模型，已切换为规则模式：解读由确定性模板生成，数字不变" };
  statusCache = { at: Date.now(), status };
  return status;
}

/** 测试用：清空状态缓存。 */
export function resetAIStatusCache() {
  statusCache = undefined;
}

export interface Interpretation {
  text: string;
  /** "ollama:qwen2.5:7b" / "openai-compat:gpt-4o-mini" / "rules"，调用方应随预测记录持久化 */
  source: string;
}

/**
 * 统一的"AI 优先、规则兜底"入口。
 * fallback 必须是确定性模板：AI 超时、报错、返回空，都静默降级为模板文本，
 * 保证无 GPU、无网络、无 Key 的环境下功能完整可用。
 */
export async function completeWithFallback(
  messages: AIMessage[],
  fallback: () => string,
  options: AICompleteOptions = {},
): Promise<Interpretation> {
  const provider = await resolveProvider();
  if (provider) {
    try {
      const text = await provider.complete(messages, options);
      return { text, source: `${provider.name}:${provider.model}` };
    } catch {
      // 调用失败降级为规则模式
    }
  }
  return { text: fallback(), source: "rules" };
}
