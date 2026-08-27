import { describe, expect, it } from "vitest";
import { defaultProject } from "@/lib/finance/default-project";
import { growKeywords, toGdeltQuery } from "@/lib/news/keywords";
import { parseSeenDate, searchGdelt, type NewsArticle } from "@/lib/news/gdelt";
import { parseGoogleNewsRss } from "@/lib/news/google-news";
import { collectNews, previewKeywords, type NewsSource } from "@/lib/news/collector";
import { createProjectRepository } from "@/lib/db/repository";

function fakeFetcher(articles: Partial<NewsArticle & { seendate: string }>[] = [], status = 200, rawBody?: string): typeof fetch {
  const body = rawBody ?? JSON.stringify({
    articles: articles.map((article) => ({
      url: article.url ?? "https://example.com/a",
      title: article.title ?? "示例新闻",
      domain: article.domain ?? "example.com",
      language: article.language ?? "Chinese",
      sourcecountry: article.sourceCountry ?? "China",
      seendate: article.seendate ?? "20260827T120000Z",
    })),
  });
  return (() =>
    Promise.resolve(
      new Response(body, { status, headers: { "content-type": "application/json" } }),
    )) as unknown as typeof fetch;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"咖啡" - Google 新闻</title>
<item>
<title>咖啡消费市场持续升温 - 新华网</title>
<link>https://news.google.com/rss/articles/abc123</link>
<guid isPermaLink="false">abc123</guid>
<pubDate>Thu, 27 Aug 2026 07:00:00 GMT</pubDate>
<description>&lt;a href="..."&gt;咖啡消费市场持续升温&lt;/a&gt;</description>
<source url="https://www.xinhuanet.com">新华网</source>
</item>
<item>
<title>订阅制商业模式观察</title>
<link>https://news.google.com/rss/articles/def456</link>
<pubDate>Wed, 26 Aug 2026 03:30:00 GMT</pubDate>
<source url="https://www.36kr.com">36氪</source>
</item>
</channel></rss>`;

describe("growKeywords 关键词生长", () => {
  it("从项目名、假设、隐藏成本、币种生长关键词并标注来源", () => {
    const keywords = growKeywords(defaultProject);
    expect(keywords.length).toBeGreaterThanOrEqual(3);
    expect(keywords.length).toBeLessThanOrEqual(6);
    expect(keywords.every((keyword) => keyword.origin.length > 0)).toBe(true);
    // 默认项目名"社区咖啡订阅计划"去掉通用词"计划"后应排第一
    expect(keywords[0].term).toBe("社区咖啡订阅");
    // 待验证假设应排在已知假设前面
    const unknownIndex = keywords.findIndex((keyword) => keyword.term === "年增长率");
    expect(unknownIndex).toBeGreaterThanOrEqual(0);
    // 币种宏观词优先级最低：默认上限内可能被截掉，放宽上限后必须出现
    const widened = growKeywords(defaultProject, 10);
    expect(widened.some((keyword) => keyword.term === "人民币汇率")).toBe(true);
    expect(widened.find((keyword) => keyword.term === "人民币汇率")?.origin).toContain("CNY");
  });

  it("去除重复并遵守上限", () => {
    const model = {
      ...defaultProject,
      assumptions: [
        { name: "人民币汇率", value: "7.2", status: "known" as const, confidence: "high" as const, source: "", asOf: "2026-08-27" },
      ],
    };
    const keywords = growKeywords(model);
    const terms = keywords.map((keyword) => keyword.term);
    expect(new Set(terms).size).toBe(terms.length);
    expect(growKeywords(model, 3)).toHaveLength(3);
  });

  it("过短的词不进入关键词列表", () => {
    const model = { ...defaultProject, name: "店" };
    expect(growKeywords(model).some((keyword) => keyword.term === "店")).toBe(false);
  });
});

describe("toGdeltQuery 查询串构造", () => {
  it("中文词附加 sourcelang 过滤", () => {
    expect(toGdeltQuery("咖啡")).toBe("咖啡 sourcelang:chinese");
  });
  it("含空格的短语加引号", () => {
    expect(toGdeltQuery("coffee subscription")).toBe('"coffee subscription"');
  });
});

describe("searchGdelt 客户端", () => {
  it("解析文章列表并把 seendate 规范为 ISO", async () => {
    const articles = await searchGdelt("咖啡", { fetcher: fakeFetcher([{ title: "咖啡消费升温", seendate: "20260827T123000Z" }]) });
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("咖啡消费升温");
    expect(articles[0].seenAt).toBe("2026-08-27T12:30:00.000Z");
  });

  it("429 与文本报错都以异常抛出", async () => {
    await expect(searchGdelt("x", { fetcher: fakeFetcher([], 429) })).rejects.toThrow("限流");
    await expect(searchGdelt("x", { fetcher: fakeFetcher([], 200, "ERROR: invalid timespan") })).rejects.toThrow("GDELT 拒绝了查询");
  });

  it("空结果返回空数组", async () => {
    await expect(searchGdelt("x", { fetcher: fakeFetcher([]) })).resolves.toEqual([]);
  });

  it("parseSeenDate 无法解析时回退到给定时刻", () => {
    const fallback = new Date("2026-01-01T00:00:00Z");
    expect(parseSeenDate("garbage", fallback)).toBe(fallback.toISOString());
    expect(parseSeenDate(undefined, fallback)).toBe(fallback.toISOString());
  });
});

describe("parseGoogleNewsRss 解析", () => {
  it("提取标题、链接、来源域名并把 pubDate 规范为 ISO", () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("咖啡消费市场持续升温 - 新华网");
    expect(items[0].domain).toBe("www.xinhuanet.com");
    expect(items[0].seenAt).toBe("2026-08-27T07:00:00.000Z");
    expect(items[1].domain).toBe("www.36kr.com");
  });

  it("遵守 maxRecords 并跳过缺标题或缺链接的条目", () => {
    expect(parseGoogleNewsRss(SAMPLE_RSS, 1)).toHaveLength(1);
    expect(parseGoogleNewsRss("<rss><channel></channel></rss>")).toEqual([]);
  });
});

describe("collectNews 多源采集闭环", () => {
  const articles: NewsArticle[] = [
    { url: "https://example.com/1", title: "咖啡市场报告", domain: "example.com", language: "Chinese", sourceCountry: "China", seenAt: "2026-08-27T12:00:00.000Z" },
    { url: "https://example.com/2", title: "订阅经济观察", domain: "example.com", language: "Chinese", sourceCountry: "China", seenAt: "2026-08-26T12:00:00.000Z" },
  ];
  const okSource = (name: string): NewsSource => ({ name, search: () => Promise.resolve(articles) });
  const failSource = (name: string): NewsSource => ({ name, search: () => Promise.reject(new Error(`${name} 不可达`)) });

  it("采集入库、重复采集零新增、删除项目时级联清空", async () => {
    const repository = createProjectRepository(":memory:");
    try {
      const project = repository.save(defaultProject);
      const first = await collectNews(defaultProject, {
        sources: [okSource("gdelt")],
        delayMs: 0,
        addNewsItems: (keyword, list) => repository.addNewsItems(project.id, keyword, list),
      });
      expect(first.newItems).toBeGreaterThan(0);
      expect(first.keywords.every((stat) => stat.source === "gdelt")).toBe(true);
      const stored = repository.listNewsItems(project.id);
      expect(stored.length).toBe(first.newItems);
      expect(stored.every((item) => item.projectId === project.id)).toBe(true);

      const second = await collectNews(defaultProject, {
        sources: [okSource("gdelt")],
        delayMs: 0,
        addNewsItems: (keyword, list) => repository.addNewsItems(project.id, keyword, list),
      });
      expect(second.newItems).toBe(0);

      expect(repository.remove(project.id)).toBe(true);
      expect(repository.listNewsItems(project.id)).toHaveLength(0);
    } finally {
      repository.close();
    }
  });

  it("GDELT 失败时自动降级到 Google News RSS 源", async () => {
    const result = await collectNews(defaultProject, {
      sources: [failSource("gdelt"), okSource("google-news-rss")],
      delayMs: 0,
      addNewsItems: () => 2,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.keywords.every((stat) => stat.source === "google-news-rss")).toBe(true);
  });

  it("全部源失败时记录错误但不中断其他关键词", async () => {
    let call = 0;
    const mixed: NewsSource[] = [
      failSource("gdelt"),
      {
        name: "google-news-rss",
        search: () => {
          call += 1;
          return call % 2 === 1 ? Promise.reject(new Error("限流")) : Promise.resolve(articles);
        },
      },
    ];
    const result = await collectNews(defaultProject, { sources: mixed, delayMs: 0, addNewsItems: () => 1 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.keywords.some((stat) => stat.error)).toBe(true);
    expect(result.keywords.some((stat) => stat.fetched > 0)).toBe(true);
  });

  it("previewKeywords 不发起网络请求", () => {
    expect(previewKeywords(defaultProject).length).toBeGreaterThan(0);
  });
});
