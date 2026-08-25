import type { DecisionRecord, EvaluationResult, ProjectModel } from "@/lib/finance/appraisal";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | null) {
  return value === null ? "无有效解" : `${(value * 100).toFixed(2)}%`;
}

function lines(items: string[], fallback = "无") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

export function decisionRecordToMarkdown(
  project: ProjectModel,
  evaluation: EvaluationResult,
  record: DecisionRecord,
) {
  const generatedAt = new Date().toISOString();
  return `# ${project.name}｜决策审计记录

> 生成时间：${generatedAt}  
> 币种：${project.currency}  
> 结论：**${record.recommendation}**

## 1. 决策问题和目标

${record.question}

## 2. 使用的分析框架

${record.framework}

## 3. 基准方案和替代方案

- 基准：${record.baseline}
${lines(record.alternatives)}

## 4. 已知、估算和未知输入

### 已知
${lines(record.inputs.known)}

### 估算
${lines(record.inputs.estimated)}

### 待验证
${lines(record.inputs.unknown)}

## 5. 隐藏成本检查

${lines(record.hiddenCosts)}

## 6. 逐期现金流与公式

${record.formula}

| 期数 | 自由现金流 |
| ---: | ---: |
${record.cashFlowTable.map((row) => `| ${row.period} | ${money(row.amount, project.currency)} |`).join("\n")}

## 7. 核心财务指标

| 指标 | 结果 |
| --- | ---: |
| NPV | ${money(evaluation.metrics.npv, project.currency)} |
| IRR | ${percent(evaluation.metrics.irr)} |
| MIRR | ${percent(evaluation.metrics.mirr)} |
| ROI | ${percent(evaluation.metrics.roi)} |
| 利润指数 | ${evaluation.metrics.profitabilityIndex.toFixed(2)} |
| 折现回收期 | ${evaluation.metrics.discountedPaybackPeriod?.toFixed(2) ?? "周期内未回收"} |

## 8. 悲观、基准和乐观情景

| 情景 | NPV | IRR |
| --- | ---: | ---: |
${record.scenarios.map((item) => `| ${item.name} | ${money(item.npv, project.currency)} | ${percent(item.irr)} |`).join("\n")}

## 9. 最敏感变量与临界值

- 最敏感变量：${record.keySensitivity.variable}
- NPV 影响跨度：${money(record.keySensitivity.impact, project.currency)}
- 临界值：${record.keySensitivity.switchingValue}

## 10. 反证与失败条件

### 反对当前结论的证据
${lines(record.counterEvidence)}

### 结论失效条件
${lines(record.failureConditions)}

## 11. 最终建议与下一步

**${record.recommendation}**

${lines(record.nextActions, "- 保存当前假设快照，并在获得新证据后重新计算")}

---

本报告不构成投资、税务或法律建议。结果仅在所列假设、数据来源和时间范围内有效。
`;
}

export function cashFlowsToCsv(cashFlows: number[]) {
  return ["period,amount", ...cashFlows.map((amount, period) => `${period},${amount}`)].join("\n");
}

export function parseCashFlowCsv(csv: string) {
  const rows = csv.trim().split(/\r?\n/);
  if (rows[0]?.trim().toLowerCase() !== "period,amount") throw new Error("CSV 表头必须为 period,amount");
  const values = rows.slice(1).map((row, index) => {
    const [periodText, amountText] = row.split(",");
    const period = Number(periodText);
    const amount = Number(amountText);
    if (period !== index || !Number.isFinite(amount)) throw new Error(`CSV 第 ${index + 2} 行无效`);
    return amount;
  });
  if (values.length < 2) throw new Error("CSV 至少需要两期现金流");
  return values;
}

export function projectToJson(project: ProjectModel) {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), project }, null, 2);
}

export function projectFromJson(json: string): ProjectModel {
  const payload = JSON.parse(json) as { version?: number; project?: ProjectModel };
  if (payload.version !== 1 || !payload.project?.name) throw new Error("项目 JSON 格式或版本无效");
  return payload.project;
}
