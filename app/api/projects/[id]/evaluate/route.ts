import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { buildDecisionRecord, evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json().catch(() => null) as ProjectModel | null;
    const project = body ?? getProjectRepository().get((await params).id)?.model;
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const evaluation = evaluateProject(project);
    return NextResponse.json({ evaluation, decisionRecord: buildDecisionRecord(project, evaluation) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "评估失败" }, { status: 400 }); }
}
