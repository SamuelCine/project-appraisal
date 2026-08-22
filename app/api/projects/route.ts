import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import type { ProjectModel } from "@/lib/finance/appraisal";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json(getProjectRepository().list()); }
export async function POST(request: Request) {
  try { return NextResponse.json(getProjectRepository().save(await request.json() as ProjectModel), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
