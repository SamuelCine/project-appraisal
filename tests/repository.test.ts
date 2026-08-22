import { afterEach, describe, expect, it } from "vitest";
import { createProjectRepository } from "@/lib/db/repository";
import type { ProjectModel } from "@/lib/finance/appraisal";

const model: ProjectModel = {
  name: "测试项目",
  currency: "CNY",
  periods: 3,
  discountRate: 0.1,
  stretchReturnRate: 0.2,
  inflationMode: "nominal",
  discountRateMode: "nominal",
  revenue: { prospects: 100, conversionRate: 0.1, averageTicket: 1000, frequency: 2, annualGrowth: 0.05 },
  variableCostRate: 0.2,
  annualFixedOperatingCost: 10000,
  taxRate: 0.2,
  necessaryStartupCost: 20000,
  minimumOperatingCost: 10000,
  workingCapital: 5000,
  riskContingency: 3000,
  terminalValue: 2000,
  sunkCost: 1000,
  assumptions: [],
  hiddenCosts: [],
};

describe("project repository", () => {
  const repositories: ReturnType<typeof createProjectRepository>[] = [];
  afterEach(() => repositories.splice(0).forEach((repository) => repository.close()));

  it("saves, lists, and reloads a project model", () => {
    const repository = createProjectRepository(":memory:");
    repositories.push(repository);
    const saved = repository.save(model);
    expect(repository.list()).toEqual([{ id: saved.id, name: "测试项目", currency: "CNY", updatedAt: saved.updatedAt }]);
    expect(repository.get(saved.id)?.model).toEqual(model);
  });

  it("updates the existing row when saving with an id", () => {
    const repository = createProjectRepository(":memory:");
    repositories.push(repository);
    const first = repository.save(model);
    const second = repository.save({ ...model, name: "更新后的项目" }, first.id);
    expect(second.id).toBe(first.id);
    expect(repository.list()).toHaveLength(1);
    expect(repository.get(first.id)?.model.name).toBe("更新后的项目");
  });
});
