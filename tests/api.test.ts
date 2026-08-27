import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 在任何路由模块加载前指定隔离的测试数据库
const tempDir = mkdtempSync(join(tmpdir(), "appraisal-api-"));
process.env.PROJECT_DB_PATH = join(tempDir, "test.db");

const { GET: listProjects, POST: createProject } = await import("@/app/api/projects/route");
const { GET: getProject, PUT: updateProject, DELETE: deleteProject } = await import("@/app/api/projects/[id]/route");
const { POST: evaluateProject } = await import("@/app/api/projects/[id]/evaluate/route");
const { POST: reverseProject } = await import("@/app/api/projects/[id]/reverse/route");
const { POST: simulateProjectRoute } = await import("@/app/api/projects/[id]/simulate/route");
const { GET: aiStatus } = await import("@/app/api/ai/status/route");
const { GET: listNews } = await import("@/app/api/projects/[id]/news/route");
const { POST: refreshNews } = await import("@/app/api/projects/[id]/news/refresh/route");
const { getProjectRepository } = await import("@/lib/db/repository");

afterAll(() => {
  getProjectRepository().close();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const emptyPost = () => new Request("http://localhost/api", { method: "POST" });
const badJsonRequest = () =>
  new Request("http://localhost/api", { method: "PUT", headers: { "content-type": "application/json" }, body: "not-json" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("projects API", () => {
  let projectId = "";

  it("normalizes a partial model on create instead of storing a broken project", async () => {
    const response = await createProject(jsonRequest({ name: "残缺项目" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    projectId = body.id;
    expect(body.model.periods).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.model.assumptions)).toBe(true);
  });

  it("rejects invalid JSON with a 400, not an unhandled 500", async () => {
    const response = await createProject(badJsonRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("请求体不是有效 JSON");
  });

  it("evaluates the stored project when the body is empty", async () => {
    const response = await evaluateProject(emptyPost(), params(projectId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evaluation.metrics.npv).toBeTypeOf("number");
    expect(body.decisionRecord.recommendation).toBeTruthy();
  });

  it("updates in place, deletes, and 404s afterwards", async () => {
    const updated = await updateProject(jsonRequest({ name: "更新后" }), params(projectId));
    expect(updated.status).toBe(200);
    expect((await updated.json()).model.name).toBe("更新后");
    const list = await (await listProjects()).json();
    expect(list.filter((row: { id: string }) => row.id === projectId)).toHaveLength(1);

    expect((await deleteProject(new Request("http://localhost/api"), params(projectId))).status).toBe(200);
    expect((await getProject(new Request("http://localhost/api"), params(projectId))).status).toBe(404);
    expect((await deleteProject(new Request("http://localhost/api"), params(projectId))).status).toBe(404);
  });

  it("returns 404 when evaluating a missing project with no body", async () => {
    const response = await evaluateProject(emptyPost(), params("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("validates reverse-valuation input with clear Chinese errors", async () => {
    const emptyResponse = await reverseProject(emptyPost());
    expect(emptyResponse.status).toBe(400);
    expect((await emptyResponse.json()).error).toBe("请求体不能为空");

    const missingRates = await reverseProject(jsonRequest({ futureCashFlows: [{ period: 3, amount: 100 }] }));
    expect(missingRates.status).toBe(400);
    expect((await missingRates.json()).error).toContain("minimumHurdleRate");

    const ok = await reverseProject(
      jsonRequest({
        futureCashFlows: [{ period: 3, amount: 1_000_000 }],
        minimumHurdleRate: 0.1,
        stretchReturnRate: 0.2,
        equityShare: 1,
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).valueCeiling).toBeCloseTo(751314.8, 1);
  });

  it("simulates a stored project and stays reproducible for the same seed", async () => {
    const created = await createProject(jsonRequest({ name: "模拟项目" }));
    const id = (await created.json()).id;
    const url = "http://localhost/api?iterations=100&seed=9";
    const first = await simulateProjectRoute(new Request(url, { method: "POST" }), params(id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.simulation.iterations).toBe(100);
    expect(firstBody.simulation.options.seed).toBe(9);
    expect(firstBody.simulation.npv.p10).toBeLessThanOrEqual(firstBody.simulation.npv.p90);
    expect(firstBody.interpretation).toBeNull();
    const second = await simulateProjectRoute(new Request(url, { method: "POST" }), params(id));
    expect((await second.json()).simulation).toEqual(firstBody.simulation);
  });

  it("returns rule-mode interpretation with explain=1 when no AI model is available", async () => {
    process.env.AI_PROVIDER = "auto";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    delete process.env.OPENAI_API_KEY;
    const response = await simulateProjectRoute(
      new Request("http://localhost/api?iterations=50&explain=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "解释项目" }),
      }),
      params("preview"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.interpretation.source).toBe("rules");
    expect(body.interpretation.text).toContain("时间线与回报分布");
  });

  it("reports AI status without crashing when nothing is installed", async () => {
    process.env.AI_PROVIDER = "auto";
    delete process.env.OPENAI_API_KEY;
    const response = await aiStatus(new Request("http://localhost/api?refresh=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(["ai", "rules"]).toContain(body.mode);
  });

  it("returns 404 when simulating a missing project with no body", async () => {
    const response = await simulateProjectRoute(emptyPost(), params("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("news: dry-run previews keywords without any network call", async () => {
    const created = await createProject(jsonRequest({ name: "咖啡情报项目" }));
    const id = (await created.json()).id;
    const dry = await refreshNews(new Request("http://localhost/api?dry=1", { method: "POST" }), params(id));
    expect(dry.status).toBe(200);
    const dryBody = await dry.json();
    expect(dryBody.dryRun).toBe(true);
    expect(dryBody.keywords.length).toBeGreaterThan(0);
    expect(dryBody.keywords[0].origin).toContain("项目名");
  });

  it("news: lists an empty pool for a fresh project and 404s for missing ones", async () => {
    const created = await createProject(jsonRequest({ name: "空情报池项目" }));
    const id = (await created.json()).id;
    const list = await listNews(new Request("http://localhost/api"), params(id));
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.items).toEqual([]);
    expect(body.keywords.length).toBeGreaterThan(0);

    const missing = await listNews(new Request("http://localhost/api"), params("does-not-exist"));
    expect(missing.status).toBe(404);
    const missingRefresh = await refreshNews(emptyPost(), params("does-not-exist"));
    expect(missingRefresh.status).toBe(404);
  });
});
