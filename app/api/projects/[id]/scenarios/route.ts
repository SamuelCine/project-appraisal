import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJsonBody(request);
    const project: ProjectModel | null =
      body !== null
        ? normalizeProjectModel(body)
        : getProjectRepository().get((await params).id)?.model ?? null;
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    return NextResponse.json(evaluateProject(project).scenarios);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "情景分析失败" }, { status: 400 }); }
}
