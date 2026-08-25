import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json(getProjectRepository().list()); }
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (body === null) return NextResponse.json({ error: "请求体不能为空" }, { status: 400 });
    return NextResponse.json(getProjectRepository().save(normalizeProjectModel(body)), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
