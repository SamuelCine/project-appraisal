import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { buildDecisionRecord, evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";

/** 解析项目模型：请求体优先，空 body 回退到已保存项目。 */
async function resolveModel(request: Request, id: string): Promise<ProjectModel | null> {
  const body = await readJsonBody(request);
  if (body !== null) return normalizeProjectModel(body);
  return getProjectRepository().get(id)?.model ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const project = await resolveModel(request, (await params).id);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const evaluation = evaluateProject(project);
    return NextResponse.json({ evaluation, decisionRecord: buildDecisionRecord(project, evaluation) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "评估失败" }, { status: 400 }); }
}
