import { NextResponse } from "next/server";
import { evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";

export async function POST(request: Request) {
  try { return NextResponse.json(evaluateProject(await request.json() as ProjectModel).scenarios); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "情景分析失败" }, { status: 400 }); }
}
