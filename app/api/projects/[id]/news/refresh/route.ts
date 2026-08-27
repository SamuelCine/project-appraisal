import { NextResponse } from "next/server";
import { getProjectRepository } from "@/lib/db/repository";
import { collectNews, previewKeywords } from "@/lib/news/collector";

export const runtime = "nodejs";

/**
 * 触发项目新闻采集。新闻挂在已保存项目上（需要持久 id），未保存项目返回 404。
 * ?dry=1 只返回将要使用的关键词与来源，不发起任何外部请求——供用户审计关键词生长。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getProjectRepository();
  const project = repository.get(id);
  if (!project) return NextResponse.json({ error: "项目不存在，请先保存项目再采集新闻" }, { status: 404 });

  if (new URL(request.url).searchParams.get("dry") === "1") {
    return NextResponse.json({ keywords: previewKeywords(project.model), dryRun: true });
  }

  const result = await collectNews(project.model, {
    addNewsItems: (keyword, articles) => repository.addNewsItems(id, keyword, articles),
  });
  const total = repository.listNewsItems(id, 200).length;
  return NextResponse.json({ ...result, totalItems: total });
}
