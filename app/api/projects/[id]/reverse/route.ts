import { NextResponse } from "next/server";
import { calculateReverseValuation, type ReverseValuationInput } from "@/lib/finance/appraisal";

export async function POST(request: Request) {
  try { return NextResponse.json(calculateReverseValuation(await request.json() as ReverseValuationInput)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "反向计算失败" }, { status: 400 }); }
}
