import { NextResponse } from "next/server";
import { calculateReverseValuation, type ReverseValuationInput } from "@/lib/finance/appraisal";
import { readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";

function validateReverseInput(body: unknown): ReverseValuationInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("反向估值输入必须是对象");
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.futureCashFlows) || raw.futureCashFlows.length === 0) throw new Error("futureCashFlows 至少需要一个未来现金流");
  const futureCashFlows = raw.futureCashFlows.map((item, index) => {
    const flow = item as { period?: unknown; amount?: unknown };
    const period = Number(flow?.period);
    const amount = Number(flow?.amount);
    if (!Number.isFinite(period) || period < 0 || !Number.isFinite(amount)) throw new Error(`futureCashFlows 第 ${index + 1} 项无效`);
    return { period, amount };
  });
  const num = (key: string, fallback = 0) => {
    const value = raw[key];
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${key} 必须是有限数值`);
    return parsed;
  };
  const minimumHurdleRate = num("minimumHurdleRate", NaN);
  const stretchReturnRate = num("stretchReturnRate", NaN);
  if (!Number.isFinite(minimumHurdleRate) || !Number.isFinite(stretchReturnRate)) {
    throw new Error("minimumHurdleRate 与 stretchReturnRate 必填");
  }
  const equityShare = num("equityShare", 1);
  if (equityShare <= 0 || equityShare > 1) throw new Error("equityShare 必须在 (0, 1] 区间");
  return {
    futureCashFlows,
    minimumHurdleRate,
    stretchReturnRate,
    necessaryStartupCost: num("necessaryStartupCost"),
    minimumOperatingCost: num("minimumOperatingCost"),
    workingCapital: num("workingCapital"),
    riskContingency: num("riskContingency"),
    equityShare,
    futureFunding: num("futureFunding"),
    debt: num("debt"),
    preferenceAdjustment: num("preferenceAdjustment"),
  };
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (body === null) return NextResponse.json({ error: "请求体不能为空" }, { status: 400 });
    return NextResponse.json(calculateReverseValuation(validateReverseInput(body)));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "反向计算失败" }, { status: 400 }); }
}
