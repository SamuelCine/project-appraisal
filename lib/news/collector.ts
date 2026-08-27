import type { ProjectModel } from "@/lib/finance/appraisal";
import { searchGdelt, type NewsArticle } from "./gdelt";
import { searchGoogleNews } from "./google-news";
import { proxyAwareFetch } from "./http";
import { growKeywords, type NewsKeyword } from "./keywords";

/**
 * 新闻采集器：关键词生长 → 多源检索 → 去重入库。
 *
 * 源链策略（见 docs/13-AI增强方案.md 第 3 节）：
 * - GDELT 优先（覆盖广、带国家/语言元数据），8 秒快速失败；
 * - Google News RSS 兜底（经本地代理，中文查询友好）；
 * - 每个关键词独立降级，单个关键词全部源失败不中断整体采集。
 */

export interface NewsSource {
  name: string;
  search(term: string): Promise<NewsArticle[]>;
}

/** 默认源链：GDELT 直连 → Google News RSS（代理感知）。 */
export function defaultNewsSources(): NewsSource[] {
  return [
    {
      name: "gdelt",
      search: (term) => searchGdelt(term, { timeoutMs: 8000 }),
    },
    {
      name: "google-news-rss",
      search: async (term) => searchGoogleNews(term, { fetcher: await proxyAwareFetch() }),
    },
  ];
}

export interface KeywordCollectStat {
  term: string;
  origin: string;
  /** 实际产出结果的源；全部失败时为 null */
  source: string | null;
  fetched: number;
  inserted: number;
  error?: string;
}

export interface CollectNewsResult {
  keywords: KeywordCollectStat[];
  newItems: number;
  errors: string[];
}

export interface CollectNewsDeps {
  sources?: NewsSource[];
  delayMs?: number;
  addNewsItems: (keyword: string, articles: NewsArticle[]) => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function previewKeywords(model: ProjectModel, limit = 6): NewsKeyword[] {
  return growKeywords(model, limit);
}

export async function collectNews(model: ProjectModel, deps: CollectNewsDeps): Promise<CollectNewsResult> {
  const keywords = growKeywords(model);
  const sources = deps.sources ?? defaultNewsSources();
  const delayMs = deps.delayMs ?? 800;
  const sleep = deps.sleep ?? defaultSleep;
  const stats: KeywordCollectStat[] = [];
  const errors: string[] = [];

  for (const [index, keyword] of keywords.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    let stat: KeywordCollectStat | null = null;
    const failureNotes: string[] = [];
    for (const source of sources) {
      try {
        const articles = await source.search(keyword.term);
        const inserted = deps.addNewsItems(keyword.term, articles);
        stat = { term: keyword.term, origin: keyword.origin, source: source.name, fetched: articles.length, inserted };
        break;
      } catch (error) {
        failureNotes.push(`${source.name}: ${error instanceof Error ? error.message : "失败"}`);
      }
    }
    if (!stat) {
      const message = failureNotes.join("；");
      stat = { term: keyword.term, origin: keyword.origin, source: null, fetched: 0, inserted: 0, error: message };
      errors.push(`${keyword.term}：${message}`);
    }
    stats.push(stat);
  }

  return {
    keywords: stats,
    newItems: stats.reduce((total, stat) => total + stat.inserted, 0),
    errors,
  };
}
