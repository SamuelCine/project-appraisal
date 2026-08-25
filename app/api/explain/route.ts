import { NextResponse } from "next/server";
import { buildDecisionRecord, evaluateProject } from "@/lib/finance/appraisal";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";
import { decisionRecordToMarkdown } from "@/lib/report/export";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (body === null) return NextResponse.json({ error: "请求体不能为空" }, { status: 400 });
    const project = normalizeProjectModel(body);
    const evaluation = evaluateProject(project);
    const record = buildDecisionRecord(project, evaluation);
    return NextResponse.json({ mode: "deterministic", record, markdown: decisionRecordToMarkdown(project, evaluation, record) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "解释生成失败" }, { status: 400 }); }
}
