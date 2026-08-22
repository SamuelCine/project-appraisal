import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import type { ProjectModel } from "@/lib/finance/appraisal";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getProjectRepository().get((await params).id);
  return project ? NextResponse.json(project) : NextResponse.json({ error: "项目不存在" }, { status: 404 });
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json(getProjectRepository().save(await request.json() as ProjectModel, (await params).id));
}
