import { NextResponse } from "next/server";
import { getAIStatus } from "@/lib/ai/provider";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const status = await getAIStatus(forceRefresh);
  return NextResponse.json(status);
}
