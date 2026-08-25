import { describe, expect, it } from "vitest";
import { fetchFrankfurterRate, fetchFredObservation, fetchReferenceRate, fetchTradingEconomicsIndicator } from "@/lib/market/providers";

describe("market data adapters", () => {
  it("normalizes a Frankfurter reference exchange rate with freshness metadata", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([
      { date: "2026-08-20", base: "USD", quote: "CNY", rate: 7.18 },
    ]));
    const result = await fetchFrankfurterRate("USD", "CNY", fetcher, new Date("2026-08-21T00:00:00Z"));
    expect(result).toEqual({
      key: "FX_USD_CNY",
      value: 7.18,
      source: "Frankfurter / central-bank reference rates",
      observedAt: "2026-08-20",
      fetchedAt: "2026-08-21T00:00:00.000Z",
      unit: "CNY per USD",
      currency: "CNY",
      frequency: "daily-reference",
      isStale: false,
    });
  });

  it("marks an old reference rate stale", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([
      { date: "2026-08-10", base: "USD", quote: "CNY", rate: 7.1 },
    ]));
    const result = await fetchFrankfurterRate("USD", "CNY", fetcher, new Date("2026-08-21T00:00:00Z"));
    expect(result.isStale).toBe(true);
  });

  it("normalizes the latest valid FRED observation", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      observations: [
        { date: "2026-07-01", value: "." },
        { date: "2026-08-01", value: "2.7" },
      ],
    }));
    const result = await fetchFredObservation("CPIAUCSL", "key", fetcher, new Date("2026-08-20T12:00:00Z"));
    expect(result.value).toBe(2.7);
    expect(result.source).toBe("FRED / Federal Reserve Bank of St. Louis");
    expect(result.observedAt).toBe("2026-08-01");
  });

  it("throws a visible provider error instead of inventing a value", async () => {
    const fetcher: typeof fetch = async () => new Response("unavailable", { status: 503 });
    await expect(fetchFrankfurterRate("USD", "CNY", fetcher)).rejects.toThrow("汇率服务暂时不可用");
  });

  it("falls back to ECB reference rates when Frankfurter is unavailable", async () => {
    let request = 0;
    const fetcher: typeof fetch = async () => {
      request += 1;
      if (request === 1) return new Response("down", { status: 503 });
      return new Response(`<gesmes:Envelope><Cube><Cube time='2026-08-20'><Cube currency='USD' rate='1.2000'/><Cube currency='CNY' rate='8.4000'/></Cube></Cube></gesmes:Envelope>`);
    };
    const result = await fetchReferenceRate("USD", "CNY", fetcher, new Date("2026-08-21T00:00:00Z"));
    expect(result.value).toBeCloseTo(7, 6);
    expect(result.source).toBe("ECB euro reference exchange rates");
  });

  it("normalizes an optional Trading Economics indicator", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([
      { Country: "China", Category: "Inflation Rate", DateTime: "2026-07-31T00:00:00", Value: 1.2, Unit: "percent" },
    ]));
    const result = await fetchTradingEconomicsIndicator("China", "Inflation Rate", "paid-key", fetcher, new Date("2026-08-20T00:00:00Z"));
    expect(result).toMatchObject({ key: "TE_CHINA_INFLATION_RATE", value: 1.2, unit: "percent", source: "Trading Economics" });
  });
});
