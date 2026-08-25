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
});
