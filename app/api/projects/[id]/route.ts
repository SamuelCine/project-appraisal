import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getProjectRepository().get((await params).id);
  return project ? NextResponse.json(project) : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    if (!getProjectRepository().get(id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const body = await readJsonBody(request);
    if (body === null) return NextResponse.json({ error: "请求体不能为空" }, { status: 400 });
    return NextResponse.json(getProjectRepository().save(normalizeProjectModel(body), id));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const removed = getProjectRepository().remove((await params).id);
  return removed
    ? NextResponse.json({ removed: true })
    : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}
