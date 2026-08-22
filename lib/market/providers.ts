export interface MarketSnapshot {
  key: string;
  value: number;
  source: string;
  observedAt: string;
  fetchedAt: string;
  unit: string;
  currency: string;
  frequency: "daily-reference" | "monthly" | "near-real-time";
  isStale: boolean;
}

const MS_PER_DAY = 86_400_000;

function olderThan(observedAt: string, now: Date, days: number) {
  const observed = new Date(`${observedAt}T00:00:00Z`);
  return !Number.isFinite(observed.getTime()) || now.getTime() - observed.getTime() > days * MS_PER_DAY;
}

export async function fetchFrankfurterRate(
  base: string,
  quote: string,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<MarketSnapshot> {
  const normalizedBase = base.toUpperCase();
  const normalizedQuote = quote.toUpperCase();
  const response = await fetcher(
    `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(normalizedBase)}&quotes=${encodeURIComponent(normalizedQuote)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("汇率服务暂时不可用，请使用手工汇率或稍后重试");
  const payload = (await response.json()) as Array<{ date: string; base: string; quote: string; rate: number }>;
  const latest = payload[0];
  if (!latest || !Number.isFinite(latest.rate)) throw new Error("汇率服务返回了无效数据");
  return {
    key: `FX_${normalizedBase}_${normalizedQuote}`,
    value: latest.rate,
    source: "Frankfurter / central-bank reference rates",
    observedAt: latest.date,
    fetchedAt: now.toISOString(),
    unit: `${normalizedQuote} per ${normalizedBase}`,
    currency: normalizedQuote,
    frequency: "daily-reference",
    isStale: olderThan(latest.date, now, 3),
  };
}

async function fetchEcbRate(
  base: string,
  quote: string,
  fetcher: typeof fetch,
  now: Date,
): Promise<MarketSnapshot> {
  const response = await fetcher("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { cache: "no-store" });
  if (!response.ok) throw new Error("ECB 参考汇率暂时不可用");
  const xml = await response.text();
  const observedAt = xml.match(/time=['\"]([^'\"]+)['\"]/)?.[1];
  if (!observedAt) throw new Error("ECB 返回了无效日期");
  const rates = new Map<string, number>([["EUR", 1]]);
  for (const match of xml.matchAll(/currency=['\"]([A-Z]{3})['\"]\s+rate=['\"]([0-9.]+)['\"]/g)) rates.set(match[1], Number(match[2]));
  const baseRate = rates.get(base.toUpperCase());
  const quoteRate = rates.get(quote.toUpperCase());
  if (!baseRate || !quoteRate) throw new Error("ECB 不支持所选币种");
  return {
    key: `FX_${base.toUpperCase()}_${quote.toUpperCase()}`,
    value: quoteRate / baseRate,
    source: "ECB euro reference exchange rates",
    observedAt,
    fetchedAt: now.toISOString(),
    unit: `${quote.toUpperCase()} per ${base.toUpperCase()}`,
    currency: quote.toUpperCase(),
    frequency: "daily-reference",
    isStale: olderThan(observedAt, now, 3),
  };
}

export async function fetchReferenceRate(base: string, quote: string, fetcher: typeof fetch = fetch, now = new Date()) {
  try { return await fetchFrankfurterRate(base, quote, fetcher, now); }
  catch { return fetchEcbRate(base, quote, fetcher, now); }
}

export async function fetchFredObservation(
  seriesId: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<MarketSnapshot> {
  if (!apiKey) throw new Error("FRED API Key 未配置");
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "24");
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error("FRED 宏观数据暂时不可用");
  const payload = (await response.json()) as { observations?: { date: string; value: string }[] };
  const latest = payload.observations?.find((item) => Number.isFinite(Number(item.value)));
  if (!latest) throw new Error("FRED 没有返回有效观察值");
  return {
    key: `FRED_${seriesId}`,
    value: Number(latest.value),
    source: "FRED / Federal Reserve Bank of St. Louis",
    observedAt: latest.date,
    fetchedAt: now.toISOString(),
    unit: "series-defined",
    currency: "USD",
    frequency: "monthly",
    isStale: olderThan(latest.date, now, 62),
  };
}

export async function fetchTradingEconomicsIndicator(
  country: string,
  indicator: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<MarketSnapshot> {
  if (!apiKey) throw new Error("Trading Economics API Key 未配置");
  const url = `https://api.tradingeconomics.com/historical/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?c=${encodeURIComponent(apiKey)}`;
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Trading Economics 数据暂时不可用");
  const payload = await response.json() as Array<{ DateTime: string; Value: number; Unit?: string }>;
  const latest = payload.filter((item) => Number.isFinite(item.Value)).sort((a, b) => b.DateTime.localeCompare(a.DateTime))[0];
  if (!latest) throw new Error("Trading Economics 没有返回有效观察值");
  const observedAt = latest.DateTime.slice(0, 10);
  const slug = `${country}_${indicator}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    key: `TE_${slug}`,
    value: latest.Value,
    source: "Trading Economics",
    observedAt,
    fetchedAt: now.toISOString(),
    unit: latest.Unit ?? "provider-defined",
    currency: "N/A",
    frequency: "near-real-time",
    isStale: olderThan(observedAt, now, 45),
  };
}
