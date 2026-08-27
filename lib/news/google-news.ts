import type { NewsArticle } from "./gdelt";

/**
 * Google News RSS 源：免费、无 Key、支持中文查询。
 * GDELT 不可直连的网络环境下（如大陆网络）经本地代理访问，是 GDELT 的兜底源。
 * 链接保留 Google 跳转 URL 与原始来源名，满足可审计要求。
 */

export interface GoogleNewsOptions {
  timeoutMs?: number;
  maxRecords?: number;
  /** 依赖注入：测试用假 fetcher；生产传 proxyAwareFetch() 的结果 */
  fetcher?: typeof fetch;
}

function decodeEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decodeEntities(match[1]) : "";
}

function sourceName(block: string) {
  const match = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
  if (!match) return { domain: "", name: "" };
  let domain = "";
  try {
    domain = new URL(match[1]).hostname;
  } catch {
    domain = "";
  }
  return { domain, name: decodeEntities(match[2]) };
}

/** 解析 Google News RSS XML 为统一的文章结构。 */
export function parseGoogleNewsRss(xml: string, maxRecords = 25): NewsArticle[] {
  const items: NewsArticle[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    const pubDate = tag(block, "pubDate");
    const parsedDate = pubDate ? new Date(pubDate) : null;
    const source = sourceName(block);
    items.push({
      url: link,
      title,
      domain: source.domain || source.name || "news.google.com",
      language: "zh-CN",
      sourceCountry: "CN",
      seenAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
    });
    if (items.length >= maxRecords) break;
  }
  return items;
}

export async function searchGoogleNews(term: string, options: GoogleNewsOptions = {}): Promise<NewsArticle[]> {
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ q: term, hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" });
  const response = await fetcher(`https://news.google.com/rss/search?${params}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
  });
  if (!response.ok) throw new Error(`Google News 请求失败（${response.status}）`);
  const xml = await response.text();
  return parseGoogleNewsRss(xml, options.maxRecords ?? 25);
}
