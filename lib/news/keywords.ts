import type { ProjectModel } from "@/lib/finance/appraisal";

/**
 * 关键词生长（见 docs/13-AI增强方案.md 第 3 节）。
 *
 * 诚实原则：不做伪分词。项目名只做"去通用后缀 + 短语查询"，
 * 假设名称与隐藏成本名称通常本身就是名词短语，直接作为查询词。
 * 每个关键词都标注来源（origin），用户可以在 dry-run 中审计"为什么这么搜"。
 */

export interface NewsKeyword {
  /** 送给 GDELT 的查询词 */
  term: string;
  /** 来源说明，如 "项目名：社区咖啡订阅计划" */
  origin: string;
}

/** 项目名里的通用后缀/修饰词，去掉后更接近实体词 */
const GENERIC_TOKENS = ["计划", "项目", "方案", "平台", "系统", "服务", "管理", "建设", "一体化", "智能", "新型", "综合", "的"];

/** 币种 → 宏观查询词（汇率与资金成本直接影响折现与现金流） */
const CURRENCY_TERMS: Record<string, string> = {
  CNY: "人民币汇率",
  USD: "美元指数",
  EUR: "欧元汇率",
  JPY: "日元汇率",
  HKD: "港元联系汇率",
};

function stripGenericTokens(name: string) {
  let result = name.trim();
  for (const token of GENERIC_TOKENS) result = result.split(token).join(" ");
  return result.replace(/\s+/g, " ").trim();
}

function pushUnique(list: NewsKeyword[], term: string, origin: string) {
  const cleaned = term.trim();
  if (cleaned.length < 2) return;
  if (list.some((item) => item.term === cleaned)) return;
  list.push({ term: cleaned, origin });
}

/**
 * 从项目模型长出新闻查询关键词，按重要性排序：
 * 1. 项目名（去通用词后的短语）
 * 2. 项目名原文（若与去后缀后不同，保留精确短语）
 * 3. 待验证/低可信假设的名称（最需要外部证据的排前面）
 * 4. 未计入的隐藏成本名称
 * 5. 币种宏观词
 */
export function growKeywords(model: ProjectModel, limit = 6): NewsKeyword[] {
  const keywords: NewsKeyword[] = [];

  const stripped = stripGenericTokens(model.name);
  if (stripped && stripped !== model.name.trim()) {
    pushUnique(keywords, stripped, `项目名（去通用词）：${model.name}`);
  }
  pushUnique(keywords, model.name, "项目名原文");

  const weakAssumptions = [...model.assumptions].sort((a, b) => {
    const rank = (status: string) => (status === "unknown" ? 0 : status === "estimated" ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });
  for (const assumption of weakAssumptions) {
    pushUnique(keywords, assumption.name, `假设（${assumption.status}）：${assumption.name}`);
  }

  for (const cost of model.hiddenCosts.filter((item) => !item.included)) {
    pushUnique(keywords, cost.name, `未计入隐藏成本：${cost.name}`);
  }

  const currencyTerm = CURRENCY_TERMS[model.currency];
  if (currencyTerm) pushUnique(keywords, currencyTerm, `币种：${model.currency}`);

  return keywords.slice(0, limit);
}

/** 构造 GDELT 查询串：中文词附加 sourcelang 过滤，短语加引号。 */
export function toGdeltQuery(term: string) {
  const hasCjk = /[一-鿿]/.test(term);
  const needsQuotes = /\s/.test(term);
  const phrase = needsQuotes ? `"${term.replace(/"/g, "")}"` : term;
  return hasCjk ? `${phrase} sourcelang:chinese` : phrase;
}
