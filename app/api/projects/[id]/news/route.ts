import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { previewKeywords } from "@/lib/news/collector";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getProjectRepository();
  const project = repository.get(id);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50;
  const items = repository.listNewsItems(id, limit);
  return NextResponse.json({
    items,
    keywords: previewKeywords(project.model),
    total: items.length,
  });
}
