import { NextResponse } from "next/server";
import { completeWithFallback } from "@/lib/ai/provider";
import { buildRuleNarrative, buildSimulationMessages } from "@/lib/ai/interpret-simulation";
import { getProjectRepository } from "@/lib/db/repository";
import type { ProjectModel } from "@/lib/finance/appraisal";
import { simulateProject, type SimulateOptions } from "@/lib/finance/simulate";
import { normalizeProjectModel, readJsonBody } from "@/lib/finance/validate";

export const runtime = "nodejs";

/** 解析项目模型：请求体优先，空 body 回退到已保存项目。与 evaluate 路由同一约定。 */
async function resolveModel(request: Request, id: string): Promise<ProjectModel | null> {
  const body = await readJsonBody(request);
  if (body !== null) return normalizeProjectModel(body);
  return getProjectRepository().get(id)?.model ?? null;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number) {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(raw: string | null, min: number, max: number, fallback: number) {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionsFromQuery(url: URL): SimulateOptions {
  const params = url.searchParams;
  return {
    iterations: clampInt(params.get("iterations"), 1, 10000, 1000),
    seed: clampInt(params.get("seed"), 0, Number.MAX_SAFE_INTEGER, 42),
    revenueSigma: clampNumber(params.get("revenueSigma"), 0, 1, 0.15),
    costSigma: clampNumber(params.get("costSigma"), 0, 1, 0.1),
    delayProbability: clampNumber(params.get("delayProbability"), 0, 1, 0.25),
    maxDelayPeriods: clampInt(params.get("maxDelayPeriods"), 0, 10, 2),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const project = await resolveModel(request, (await params).id);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const url = new URL(request.url);
    const simulation = simulateProject(project, optionsFromQuery(url));
    let interpretation = null;
    if (url.searchParams.get("explain") === "1") {
      interpretation = await completeWithFallback(
        buildSimulationMessages(project.name, project.currency, simulation),
        () => buildRuleNarrative(simulation, project.currency),
        { temperature: 0.2, maxTokens: 600, timeoutMs: 120000 },
      );
    }
    return NextResponse.json({ simulation, interpretation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "模拟失败" }, { status: 400 });
  }
}
