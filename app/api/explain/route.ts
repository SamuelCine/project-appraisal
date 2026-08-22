import { NextResponse } from "next/server";
import { buildDecisionRecord, evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";
import { decisionRecordToMarkdown } from "@/lib/report/export";

export async function POST(request: Request) {
  try { const project = await request.json() as ProjectModel; const evaluation = evaluateProject(project); const record = buildDecisionRecord(project, evaluation); return NextResponse.json({ mode: "deterministic", record, markdown: decisionRecordToMarkdown(project, evaluation, record) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "解释生成失败" }, { status: 400 }); }
}
