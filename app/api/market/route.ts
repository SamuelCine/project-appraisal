import { NextRequest, NextResponse } from "next/server";
import { fetchFredObservation, fetchReferenceRate, fetchTradingEconomicsIndicator } from "@/lib/market/providers";

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") ?? "fx";
    if (type === "fx") return NextResponse.json(await fetchReferenceRate(request.nextUrl.searchParams.get("base") ?? "USD", request.nextUrl.searchParams.get("quote") ?? "CNY"));
    if (type === "fred") return NextResponse.json(await fetchFredObservation(request.nextUrl.searchParams.get("series") ?? "CPIAUCSL", process.env.FRED_API_KEY ?? ""));
    if (type === "te") return NextResponse.json(await fetchTradingEconomicsIndicator(request.nextUrl.searchParams.get("country") ?? "China", request.nextUrl.searchParams.get("indicator") ?? "Inflation Rate", process.env.TRADING_ECONOMICS_API_KEY ?? ""));
    return NextResponse.json({ error: "不支持的数据类型" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "市场数据不可用" }, { status: 503 }); }
}
