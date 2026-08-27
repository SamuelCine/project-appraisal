import { toGdeltQuery } from "./keywords";

/**
 * GDELT DOC 2.0 客户端：免费、无 Key、全球新闻近实时索引。
 * https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
 *
 * 只取元数据（标题/链接/来源/时间），正文摘要留给后续阶段；
 * 所有外部条目都会带 URL 与来源入库，满足可审计要求。
 */

export interface NewsArticle {
  url: string;
  title: string;
  domain: string;
  language: string;
  sourceCountry: string;
  /** ISO 时间 */
  seenAt: string;
}

export interface GdeltSearchOptions {
  /** 时间窗，GDELT timespan 语法，默认 "1month" */
  timespan?: string;
  /** 返回上限，默认 25（单关键词），GDELT 上限 250 */
  maxRecords?: number;
  timeoutMs?: number;
  /** 依赖注入：测试用假 fetcher，生产用全局 fetch */
  fetcher?: typeof fetch;
}

const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";

/** GDELT seendate 格式 "20260827T123000Z" → ISO；无法解析时返回抓取时刻 */
export function parseSeenDate(raw: string | undefined, fallback = new Date()) {
  const match = raw?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return fallback.toISOString();
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

interface GdeltDocResponse {
  articles?: {
    url?: string;
    title?: string;
    domain?: string;
    language?: string;
    sourcecountry?: string;
    seendate?: string;
  }[];
}

/** 单关键词检索。限流（429）与网络错误抛异常，由调用方决定降级；空结果返回 []。 */
export async function searchGdelt(term: string, options: GdeltSearchOptions = {}): Promise<NewsArticle[]> {
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({
    query: toGdeltQuery(term),
    mode: "artlist",
    format: "json",
    timespan: options.timespan ?? "1month",
    maxrecords: String(options.maxRecords ?? 25),
    sort: "hybridrel",
  });
  const response = await fetcher(`${GDELT_DOC_API}?${params}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  if (response.status === 429) throw new Error("GDELT 限流（429），请稍后重试");
  if (!response.ok) throw new Error(`GDELT 请求失败（${response.status}）`);
  // 限流或查询串不被接受时 GDELT 可能返回 200 + 纯文本报错而不是 JSON
  const text = await response.text();
  let body: GdeltDocResponse;
  try {
    body = JSON.parse(text) as GdeltDocResponse;
  } catch {
    if (/timespan|error|limit/i.test(text)) throw new Error(`GDELT 拒绝了查询：${text.slice(0, 120)}`);
    return [];
  }
  const now = new Date();
  return (body.articles ?? [])
    .filter((article): article is Required<Pick<typeof article, "url" | "title">> & typeof article =>
      !!article.url && !!article.title,
    )
    .map((article) => ({
      url: article.url!,
      title: article.title!.trim(),
      domain: article.domain ?? new URL(article.url!).hostname,
      language: article.language ?? "",
      sourceCountry: article.sourcecountry ?? "",
      seenAt: parseSeenDate(article.seendate, now),
    }));
}
