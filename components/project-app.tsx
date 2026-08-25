"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpenCheck, Download, FileCheck2, FolderOpen,
  Gauge, Landmark, RefreshCw, Save, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  buildDecisionRecord, calculateReverseValuation, evaluateProject, type ProjectModel,
} from "@/lib/finance/appraisal";
import { defaultProject } from "@/lib/finance/default-project";
import { normalizeProjectModel } from "@/lib/finance/validate";
import type { DatedCashFlow } from "@/lib/finance/math";
import { cashFlowsToCsv, decisionRecordToMarkdown, parseCashFlowCsv, projectFromJson, projectToJson } from "@/lib/report/export";

const stages = ["定义决策", "商业验证", "隐藏成本", "收益驱动", "财务计算", "风险与决策"];

type SavedProjectRow = { id: string; name: string; currency: string; updatedAt: string };
type MarketState = { value?: number; observedAt?: string; source?: string; isStale?: boolean; error?: string };

function formatMoney(value: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency", currency,
    notation: Math.abs(value) > 999999 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatPercent(value: number | null) { return value === null ? "无解" : `${(value * 100).toFixed(1)}%`; }

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (value: number) => void; suffix?: string }) {
  return (
    <label>
      <span className="label">{label}</span>
      <div className="relative">
        <input aria-label={label} className="field num pr-12" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="absolute right-3 top-2.5 text-xs text-[var(--muted)]">{suffix}</span>
      </div>
    </label>
  );
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 解析带日期现金流 CSV：表头 date,amount，之后每行 2026-01-01,-100000 */
function parseDatedCashFlowCsv(csv: string): DatedCashFlow[] {
  const rows = csv.trim().split(/\r?\n/);
  if (rows[0]?.trim().toLowerCase() !== "date,amount") throw new Error("表头必须为 date,amount");
  const flows = rows.slice(1).map((row, index) => {
    const [dateText, amountText] = row.split(",");
    const date = new Date((dateText ?? "").trim());
    const amount = Number((amountText ?? "").trim());
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) throw new Error(`第 ${index + 2} 行无效`);
    return { date: date.toISOString().slice(0, 10), amount };
  });
  if (flows.length < 2) throw new Error("至少需要两笔现金流");
  return flows;
}

export function ProjectApp() {
  const [mode, setMode] = useState<"guide" | "workbench">("guide");
  const [stage, setStage] = useState(0);
  const [project, setProject] = useState<ProjectModel>(defaultProject);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [futureValue, setFutureValue] = useState(1_000_000);
  const [futureYear, setFutureYear] = useState(3);
  const [marketOpen, setMarketOpen] = useState(false);
  const [market, setMarket] = useState<MarketState>({});
  const [saveState, setSaveState] = useState("尚未保存");
  const [listOpen, setListOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProjectRow[]>([]);
  const [listError, setListError] = useState("");
  const [manualCsv, setManualCsv] = useState("");
  const [datedCsv, setDatedCsv] = useState("");
  const [csvError, setCsvError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // 财务引擎可能因输入组合抛出异常；捕获并展示，避免整页崩溃。
  const evaluation = useMemo(() => {
    try { return { result: evaluateProject(project), error: "" }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "评估失败" }; }
  }, [project]);
  const record = useMemo(
    () => (evaluation.result ? buildDecisionRecord(project, evaluation.result) : null),
    [project, evaluation],
  );
  const reverse = useMemo(() => calculateReverseValuation({
    futureCashFlows: [{ period: futureYear, amount: futureValue }],
    minimumHurdleRate: project.discountRate,
    stretchReturnRate: project.stretchReturnRate,
    necessaryStartupCost: project.necessaryStartupCost,
    minimumOperatingCost: project.minimumOperatingCost,
    workingCapital: project.workingCapital,
    riskContingency: project.riskContingency,
    equityShare: 1,
  }), [futureValue, futureYear, project]);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)" }, (context) => {
      if (context.conditions?.reduce) return;
      const scoped = gsap.context(() => {
        gsap.timeline({ defaults: { duration: .42, ease: "power2.out" } })
          .from("[data-animate='header']", { y: -10, autoAlpha: 0 })
          .from("[data-animate='section']", { y: 14, autoAlpha: 0, stagger: .06 }, "-=.18");
      }, rootRef);
      return () => scoped.revert();
    });
    return () => media.revert();
  }, [mode]);

  useLayoutEffect(() => {
    if (!resultRef.current || mode !== "workbench") return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const tween = gsap.fromTo(resultRef.current, { autoAlpha: .74, scale: .995 }, { autoAlpha: 1, scale: 1, duration: .3, ease: "power2.out", overwrite: "auto" });
      return () => tween.kill();
    });
    return () => media.revert();
  }, [evaluation.result?.metrics.npv, reverse.valueCeiling, mode]);

  const update = <K extends keyof ProjectModel>(key: K, value: ProjectModel[K]) =>
    setProject((current) => ({ ...current, [key]: value }));
  const updateRevenue = (key: keyof ProjectModel["revenue"], value: number) =>
    setProject((current) => ({ ...current, revenue: { ...current.revenue, [key]: value } }));

  const cumulativeData = (evaluation.result?.cashFlows ?? []).reduce<{ period: string; cashFlow: number; cumulative: number }[]>((rows, cashFlow, index) => {
    rows.push({ period: index === 0 ? "现在" : `第${index}年`, cashFlow, cumulative: cashFlow + (rows.at(-1)?.cumulative ?? 0) });
    return rows;
  }, []);
  const revenueData = (evaluation.result?.revenueByPeriod ?? []).map((revenue, index) => ({ period: `第${index + 1}年`, revenue }));

  function applyManualCsv(text: string) {
    setManualCsv(text);
    if (!text.trim()) { setProject((c) => ({ ...c, manualCashFlows: undefined })); setCsvError(""); return; }
    if (datedCsv.trim()) { setCsvError("手工现金流与带日期现金流只能二选一"); return; }
    try {
      const flows = parseCashFlowCsv(text);
      setProject((c) => ({ ...c, manualCashFlows: flows, datedCashFlows: undefined }));
      setCsvError("");
    } catch (error) { setCsvError(error instanceof Error ? error.message : "CSV 无效"); }
  }

  function applyDatedCsv(text: string) {
    setDatedCsv(text);
    if (!text.trim()) { setProject((c) => ({ ...c, datedCashFlows: undefined })); setCsvError(""); return; }
    if (manualCsv.trim()) { setCsvError("手工现金流与带日期现金流只能二选一"); return; }
    try {
      const flows = parseDatedCashFlowCsv(text);
      setProject((c) => ({ ...c, datedCashFlows: flows, manualCashFlows: undefined }));
      setCsvError("");
    } catch (error) { setCsvError(error instanceof Error ? error.message : "CSV 无效"); }
  }

  async function saveProject() {
    setSaveState("保存中…");
    try {
      const response = await fetch(projectId ? `/api/projects/${projectId}` : "/api/projects", {
        method: projectId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(project),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "保存失败");
      if (!projectId && typeof body.id === "string") setProjectId(body.id);
      setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (error) {
      setSaveState(`保存失败：${error instanceof Error ? error.message : "请确认本地服务正在运行"}`);
    }
  }

  async function openSavedList() {
    setListOpen(true);
    setListError("");
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error();
      setSavedProjects(await response.json() as SavedProjectRow[]);
    } catch { setListError("无法读取项目列表，请确认本地服务正在运行"); }
  }

  async function loadProject(id: string) {
    try {
      const response = await fetch(`/api/projects/${id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "载入失败");
      const model = normalizeProjectModel(body.model);
      setProject(model);
      setProjectId(id);
      setManualCsv(model.manualCashFlows?.length ? cashFlowsToCsv(model.manualCashFlows) : "");
      setDatedCsv(model.datedCashFlows?.length
        ? ["date,amount", ...model.datedCashFlows.map((flow) => `${flow.date},${flow.amount}`)].join("\n")
        : "");
      setListOpen(false);
      setSaveState("已载入保存的项目");
    } catch (error) { setListError(error instanceof Error ? error.message : "载入失败"); }
  }

  async function deleteProject(id: string) {
    try {
      const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      if (id === projectId) { setProjectId(null); setSaveState("当前项目已删除"); }
      setSavedProjects((rows) => rows.filter((row) => row.id !== id));
    } catch { setListError("删除失败"); }
  }

  async function importProject(file: File | undefined) {
    if (!file) return;
    try {
      const model = normalizeProjectModel(projectFromJson(await file.text()));
      setProject(model);
      setProjectId(null);
      setManualCsv(model.manualCashFlows?.length ? cashFlowsToCsv(model.manualCashFlows) : "");
      setDatedCsv("");
      setSaveState("已从 JSON 导入（尚未保存）");
    } catch (error) { setSaveState(`导入失败：${error instanceof Error ? error.message : "文件无效"}`); }
  }

  async function refreshMarket() {
    setMarket({});
    try {
      const response = await fetch("/api/market?type=fx&base=USD&quote=CNY");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMarket(body);
    } catch (error) { setMarket({ error: error instanceof Error ? error.message : "数据服务不可用" }); }
  }

  const evaluationResult = evaluation.result;

  function renderGuideContent() {
    if (stage === 0) return (
      <div className="grid gap-5 md:grid-cols-2">
        <label><span className="label">项目名称</span><input className="field" value={project.name} onChange={(e) => update("name", e.target.value)} /></label>
        <label><span className="label">你的角色</span><select className="field"><option>项目经营者</option><option>财务出资人</option><option>合作方</option></select></label>
        <NumberField label="项目周期" value={project.periods} suffix="年" onChange={(v) => update("periods", Math.max(1, Math.round(v || 1)))} />
        <label><span className="label">币种</span><select className="field" value={project.currency} onChange={(e) => update("currency", e.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option><option value="HKD">HKD 港币</option></select></label>
        <label className="md:col-span-2"><span className="label">不做项目的基准方案</span><textarea className="field min-h-24" defaultValue="保留资金，并投入当前收益最高的其他选择" /></label>
      </div>
    );
    if (stage === 1) return (
      <div className="space-y-3">
        {project.assumptions.map((item) => (
          <div key={item.name} className="grid gap-3 border-b hairline py-3 md:grid-cols-[1fr_.8fr_.8fr]">
            <div><p className="font-medium">{item.name}</p><p className="text-xs text-[var(--muted)]">{item.source} · {item.asOf}</p></div>
            <span className="num">{item.value}</span>
            <span className={`text-sm ${item.confidence === "low" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
              {item.status === "known" ? "已知" : item.status === "estimated" ? "估算" : "待验证"} · {item.confidence}
            </span>
          </div>
        ))}
      </div>
    );
    if (stage === 2) return (
      <div className="space-y-3">
        {project.hiddenCosts.map((item, index) => (
          <label key={item.name} className="flex items-center justify-between gap-4 border-b hairline py-3">
            <span><b className="font-medium">{item.name}</b><small className="ml-2 text-[var(--muted)]">{item.category}</small></span>
            <span className="flex items-center gap-4">
              <span className="num">{formatMoney(item.amount, project.currency)}</span>
              <input type="checkbox" checked={item.included} onChange={(e) => update("hiddenCosts", project.hiddenCosts.map((cost, i) => i === index ? { ...cost, included: e.target.checked } : cost))} />
            </span>
          </label>
        ))}
      </div>
    );
    if (stage === 3) return (
      <div className="grid gap-5 md:grid-cols-3">
        <NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" onChange={(v) => updateRevenue("prospects", v)} />
        <NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" onChange={(v) => updateRevenue("conversionRate", v / 100)} />
        <NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" onChange={(v) => updateRevenue("averageTicket", v)} />
        <NumberField label="年购买频次" value={project.revenue.frequency} suffix="次" onChange={(v) => updateRevenue("frequency", v)} />
        <NumberField label="收入年增长" value={project.revenue.annualGrowth * 100} suffix="%" onChange={(v) => updateRevenue("annualGrowth", v / 100)} />
        <NumberField label="变动成本率" value={project.variableCostRate * 100} suffix="%" onChange={(v) => update("variableCostRate", v / 100)} />
      </div>
    );
    if (stage === 4) return (
      <div className="space-y-6">
        <div className="grid gap-5 md:grid-cols-3">
          <NumberField label="最低可接受回报率" value={project.discountRate * 100} suffix="%" onChange={(v) => update("discountRate", v / 100)} />
          <NumberField label="目标回报率" value={project.stretchReturnRate * 100} suffix="%" onChange={(v) => update("stretchReturnRate", v / 100)} />
          <NumberField label="税率" value={project.taxRate * 100} suffix="%" onChange={(v) => update("taxRate", v / 100)} />
          <NumberField label="必要启动成本" value={project.necessaryStartupCost} suffix="元" onChange={(v) => update("necessaryStartupCost", v)} />
          <NumberField label="最低运营成本" value={project.minimumOperatingCost} suffix="元" onChange={(v) => update("minimumOperatingCost", v)} />
          <NumberField label="营运资金" value={project.workingCapital} suffix="元" onChange={(v) => update("workingCapital", v)} />
          <NumberField label="风险预备金" value={project.riskContingency} suffix="元" onChange={(v) => update("riskContingency", v)} />
          <NumberField label="年固定运营成本" value={project.annualFixedOperatingCost} suffix="元" onChange={(v) => update("annualFixedOperatingCost", v)} />
          <NumberField label="期末残值" value={project.terminalValue} suffix="元" onChange={(v) => update("terminalValue", v)} />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            <span className="label">手工现金流（可选，覆盖经营驱动）</span>
            <textarea className="field num min-h-32" placeholder={"period,amount\n0,-100000\n1,40000\n2,50000"} value={manualCsv} onChange={(e) => applyManualCsv(e.target.value)} />
          </label>
          <label>
            <span className="label">带日期现金流（可选，启用 XNPV / XIRR）</span>
            <textarea className="field num min-h-32" placeholder={"date,amount\n2026-01-01,-100000\n2027-06-01,80000\n2028-12-31,120000"} value={datedCsv} onChange={(e) => applyDatedCsv(e.target.value)} />
          </label>
        </div>
        {csvError && <p className="flex items-center gap-2 text-sm text-[var(--red)]"><AlertTriangle size={14} />{csvError}</p>}
        <div className="rounded-lg border border-[var(--line)] bg-white/40 p-4 text-sm">
          <b>口径校验通过：</b>当前使用名义现金流与名义折现率。系统不会把贷款利息与项目整体资金成本重复扣除。
        </div>
      </div>
    );
    return (
      <div className="grid gap-5 md:grid-cols-3">
        <Summary label="基准 NPV" value={evaluationResult ? formatMoney(evaluationResult.metrics.npv, project.currency) : "—"} />
        <Summary label="基准 IRR" value={evaluationResult ? formatPercent(evaluationResult.metrics.irr) : "—"} />
        <Summary label="建议" value={evaluationResult?.recommendation ?? "—"} />
        <div className="md:col-span-3 border-l-2 border-[var(--copper)] pl-4 text-sm text-[var(--muted)]">
          当前仍有 {project.hiddenCosts.filter((x) => !x.included).length} 项隐藏成本未计入、
          {project.assumptions.filter((x) => x.status === "unknown").length} 项假设待验证。进入工作台后可查看临界值与反证。
        </div>
      </div>
    );
  }

  if (mode === "guide") return (
    <div ref={rootRef} className="min-h-screen px-5 py-6 md:px-10 md:py-9">
      <header data-animate="header" className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full border border-[var(--ink)]"><Landmark size={18} /></div>
          <div><b className="tracking-[.12em]">衡策</b><p className="text-xs text-[var(--muted)]">PROJECT APPRAISAL</p></div>
        </div>
        <button className="btn-secondary" onClick={() => setMode("workbench")}>载入示例并进入工作台</button>
      </header>
      <main className="mx-auto mt-16 max-w-7xl">
        <div data-animate="section" className="max-w-3xl">
          <p className="eyebrow">Evidence before optimism</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-6xl">先把项目问清楚，再谈回报</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">六个步骤把模糊想法转化为可审计的现金流、投资上限和失败条件。数字不会替你决定，但会告诉你决定依赖什么。</p>
        </div>
        <nav data-animate="section" aria-label="考察阶段" className="mt-12 grid gap-px overflow-hidden rounded-xl border hairline bg-[var(--line)] md:grid-cols-6">
          {stages.map((item, index) => (
            <button key={item} onClick={() => setStage(index)} className={`min-h-20 bg-[var(--paper-strong)] px-4 text-left text-sm ${stage === index ? "text-[var(--copper)]" : "text-[var(--muted)]"}`}>
              <span className="num block text-xs">{String(index + 1).padStart(2, "0")}</span>
              <span className="mt-2 block font-medium">{item}</span>
            </button>
          ))}
        </nav>
        <section data-animate="section" className="surface mt-6 rounded-xl p-6 md:p-9">
          <div className="mb-8 flex items-start justify-between border-b hairline pb-5">
            <div><span className="eyebrow">阶段 {stage + 1} / 6</span><h2 className="mt-2 text-2xl font-semibold">{stages[stage]}</h2></div>
            <BookOpenCheck className="text-[var(--copper)]" />
          </div>
          {renderGuideContent()}
          <div className="mt-9 flex items-center justify-between">
            <button className="btn-secondary disabled:opacity-40" disabled={stage === 0} onClick={() => setStage((s) => s - 1)}>
              <ArrowLeft className="mr-2 inline" size={15} />上一步
            </button>
            {stage < stages.length - 1 ? (
              <button className="btn-primary" onClick={() => setStage((s) => s + 1)}>下一步<ArrowRight className="ml-2 inline" size={15} /></button>
            ) : (
              <button className="btn-primary" onClick={() => setMode("workbench")}>进入决策工作台<ArrowRight className="ml-2 inline" size={15} /></button>
            )}
          </div>
        </section>
      </main>
    </div>
  );

  return (
    <div ref={rootRef} className="min-h-screen">
      <header data-animate="header" className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b hairline bg-[rgba(243,239,231,.92)] px-5 py-3 backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-4">
          <button aria-label="返回考察向导" className="rounded-full border hairline p-2" onClick={() => setMode("guide")}><ArrowLeft size={16} /></button>
          <div><p className="eyebrow">{project.name}</p><h1 className="text-xl font-semibold">决策工作台</h1></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-[var(--muted)] md:inline">{saveState}</span>
          <button className="btn-secondary" onClick={openSavedList}><FolderOpen className="mr-2 inline" size={15} />打开项目</button>
          <button className="btn-secondary" onClick={() => setMarketOpen(true)}><Gauge className="mr-2 inline" size={15} />假设依据</button>
          <button className="btn-secondary" onClick={() => importRef.current?.click()}><Upload className="mr-2 inline" size={15} />导入</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void importProject(e.target.files?.[0]); e.target.value = ""; }} />
          {evaluationResult && record && (
            <button className="btn-secondary" onClick={() => download(`${project.name}-决策审计.md`, decisionRecordToMarkdown(project, evaluationResult, record), "text/markdown")}>
              <Download className="mr-2 inline" size={15} />导出报告
            </button>
          )}
          <button className="btn-secondary" onClick={() => download(`${project.name}.json`, projectToJson(project), "application/json")}>
            <Download className="mr-2 inline" size={15} />导出 JSON
          </button>
          <button className="btn-primary" onClick={saveProject}><Save className="mr-2 inline" size={15} />保存项目</button>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-70px)] lg:grid-cols-[.9fr_1.55fr_1fr]">
        <aside data-animate="section" className="border-r hairline p-5 md:p-6">
          <SectionTitle index="01" title="事实与证据" icon={<FileCheck2 size={16} />} />
          <div className="mt-5 space-y-3">
            {project.assumptions.map((item) => (
              <div key={item.name} className="border-b hairline pb-3">
                <div className="flex justify-between gap-3">
                  <b className="text-sm">{item.name}</b>
                  <span className={`text-xs ${item.confidence === "low" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
                    {item.status === "unknown" ? "待验证" : item.status === "estimated" ? "估算" : "已知"}
                  </span>
                </div>
                <p className="num mt-1 text-sm">{item.value}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.source} · {item.asOf}</p>
              </div>
            ))}
          </div>
          <SectionTitle index="02" title="隐藏成本" icon={<ShieldCheck size={16} />} className="mt-9" />
          <div className="mt-4 space-y-2">
            {project.hiddenCosts.map((item, index) => (
              <label key={item.name} className="flex items-center gap-3 rounded-lg border hairline bg-white/35 p-3">
                <input type="checkbox" checked={item.included} onChange={(e) => update("hiddenCosts", project.hiddenCosts.map((cost, i) => i === index ? { ...cost, included: e.target.checked } : cost))} />
                <span className="flex-1"><b className="text-sm">{item.name}</b><small className="ml-2 text-[var(--muted)]">{item.category}</small></span>
                <span className="num text-sm">{formatMoney(item.amount, project.currency)}</span>
              </label>
            ))}
          </div>
          {evaluationResult && evaluationResult.warnings.length > 0 && (
            <div className="mt-6 rounded-lg border border-[var(--copper-soft)] bg-[var(--copper-soft)]/40 p-4">
              <b className="flex items-center gap-2 text-sm"><AlertTriangle size={14} className="text-[var(--copper)]" />风险提示</b>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[var(--muted)]">
                {evaluationResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}
        </aside>

        <section data-animate="section" className="border-r hairline p-5 md:p-6">
          <SectionTitle index="03" title="收益与成本驱动" icon={<Gauge size={16} />} />
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" onChange={(v) => updateRevenue("prospects", v)} />
            <NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" onChange={(v) => updateRevenue("conversionRate", v / 100)} />
            <NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" onChange={(v) => updateRevenue("averageTicket", v)} />
            <NumberField label="年购买频次" value={project.revenue.frequency} suffix="次" onChange={(v) => updateRevenue("frequency", v)} />
            <NumberField label="收入年增长" value={project.revenue.annualGrowth * 100} suffix="%" onChange={(v) => updateRevenue("annualGrowth", v / 100)} />
            <NumberField label="变动成本率" value={project.variableCostRate * 100} suffix="%" onChange={(v) => update("variableCostRate", v / 100)} />
            <NumberField label="年固定运营成本" value={project.annualFixedOperatingCost} suffix="元" onChange={(v) => update("annualFixedOperatingCost", v)} />
            <NumberField label="必要启动成本" value={project.necessaryStartupCost} suffix="元" onChange={(v) => update("necessaryStartupCost", v)} />
            <NumberField label="税率" value={project.taxRate * 100} suffix="%" onChange={(v) => update("taxRate", v / 100)} />
          </div>

          {evaluation.error && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--red)]/30 bg-white/50 p-3 text-sm text-[var(--red)]">
              <AlertTriangle size={14} />{evaluation.error}
            </p>
          )}

          <div ref={resultRef} className="mt-8">
            <SectionTitle index="04" title="累计自由现金流" icon={<Gauge size={16} />} />
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="period" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v: number) => formatMoney(v, project.currency)} width={80} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0), project.currency)} />
                  <ReferenceLine y={0} stroke="var(--muted)" />
                  <Area type="monotone" dataKey="cumulative" name="累计现金流" stroke="var(--copper)" fill="var(--copper-soft)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {revenueData.length > 0 && (
            <div className="mt-8">
              <SectionTitle index="05" title="逐期收入" icon={<Gauge size={16} />} />
              <div className="mt-4 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="period" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v: number) => formatMoney(v, project.currency)} width={80} />
                    <Tooltip formatter={(v) => formatMoney(Number(v ?? 0), project.currency)} />
                    <Bar dataKey="revenue" name="收入" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {revenueData.map((row) => <Cell key={row.period} fill="var(--green)" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <label>
              <span className="label">手工现金流 CSV（可选，覆盖经营驱动）</span>
              <textarea className="field num min-h-28" placeholder={"period,amount\n0,-100000\n1,40000"} value={manualCsv} onChange={(e) => applyManualCsv(e.target.value)} />
            </label>
            <label>
              <span className="label">带日期现金流 CSV（可选，启用 XNPV/XIRR）</span>
              <textarea className="field num min-h-28" placeholder={"date,amount\n2026-01-01,-100000\n2027-06-01,80000"} value={datedCsv} onChange={(e) => applyDatedCsv(e.target.value)} />
            </label>
          </div>
          {csvError && <p className="mt-2 flex items-center gap-2 text-sm text-[var(--red)]"><AlertTriangle size={14} />{csvError}</p>}

          <div className="mt-8 rounded-xl border hairline bg-white/40 p-5">
            <SectionTitle index="06" title="反向投资边界" icon={<Gauge size={16} />} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <NumberField label="目标未来净现金流" value={futureValue} suffix="元" onChange={setFutureValue} />
              <NumberField label="实现时间" value={futureYear} suffix="年后" onChange={(v) => setFutureYear(Math.max(1, Math.round(v || 1)))} />
            </div>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <p><span>最低可行投入</span>：<b className="num">{formatMoney(reverse.minimumViableInvestment, project.currency)}</b></p>
              <p><span>投资价值上限</span>：<b className="num">{formatMoney(reverse.valueCeiling, project.currency)}</b></p>
              <p><span>谈判下限参考</span>：<b className="num">{formatMoney(reverse.negotiationFloor, project.currency)}</b></p>
              <p><span>安全边际</span>：<b className={`num ${reverse.safetyMargin < 0 ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{formatMoney(reverse.safetyMargin, project.currency)}</b></p>
            </div>
            {!reverse.feasible && (
              <p className="mt-3 flex items-center gap-2 text-sm text-[var(--red)]">
                <AlertTriangle size={14} />最低可行投入高于投资价值上限，当前方案在所设条件下不可行。
              </p>
            )}
          </div>
        </section>

        <aside data-animate="section" className="p-5 md:p-6">
          <SectionTitle index="07" title="价值与回报" icon={<Gauge size={16} />} />
          {evaluationResult ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <Metric label="NPV" testId="npv-value" value={formatMoney(evaluationResult.metrics.npv, project.currency)} tone={evaluationResult.metrics.npv >= 0 ? "good" : "bad"} />
              <Metric label="IRR" value={formatPercent(evaluationResult.metrics.irr)} />
              <Metric label="MIRR" value={formatPercent(evaluationResult.metrics.mirr)} />
              <Metric label="利润指数" value={evaluationResult.metrics.profitabilityIndex.toFixed(2)} />
              <Metric label="回收期" value={evaluationResult.metrics.paybackPeriod === null ? "未回收" : `${evaluationResult.metrics.paybackPeriod.toFixed(1)} 期`} />
              <Metric label="折现回收期" value={evaluationResult.metrics.discountedPaybackPeriod === null ? "未回收" : `${evaluationResult.metrics.discountedPaybackPeriod.toFixed(1)} 期`} />
              {evaluationResult.metrics.xnpv !== null && <Metric label="XNPV" value={formatMoney(evaluationResult.metrics.xnpv, project.currency)} tone={evaluationResult.metrics.xnpv >= 0 ? "good" : "bad"} />}
              {evaluationResult.metrics.xirr !== null && <Metric label="XIRR" value={formatPercent(evaluationResult.metrics.xirr)} />}
              {evaluationResult.breakEven && (
                <Metric label="盈亏平衡" value={`${Math.ceil(evaluationResult.breakEven.units)} 单 / ${formatMoney(evaluationResult.breakEven.revenue, project.currency)}`} />
              )}
            </div>
          ) : <p className="mt-4 text-sm text-[var(--muted)]">修正输入后显示指标。</p>}

          <SectionTitle index="08" title="三情景" icon={<Gauge size={16} />} className="mt-8" />
          <div className="mt-4 space-y-2">
            {evaluationResult?.scenarios.map((scenario) => (
              <div key={scenario.name} className="flex items-center justify-between rounded-lg border hairline bg-white/35 px-3 py-2 text-sm">
                <b>{scenario.name}</b>
                <span className={`num ${scenario.npv >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{formatMoney(scenario.npv, project.currency)}</span>
                <span className="num text-xs text-[var(--muted)]">{formatPercent(scenario.irr)}</span>
              </div>
            ))}
          </div>

          <SectionTitle index="09" title="敏感性与临界值" icon={<Gauge size={16} />} className="mt-8" />
          <div className="mt-4 space-y-3">
            {evaluationResult?.sensitivity.map((item) => (
              <div key={item.variable} className="border-b hairline pb-3 text-sm">
                <div className="flex justify-between"><b>{item.variable}</b><span className="num text-xs text-[var(--muted)]">影响 {formatMoney(item.impact, project.currency)}</span></div>
                <p className="mt-1 text-xs text-[var(--muted)]">临界值：{item.switchingValue}</p>
              </div>
            ))}
          </div>

          <SectionTitle index="10" title="决策建议" icon={<Gauge size={16} />} className="mt-8" />
          {evaluationResult && (
            <p className="mt-3 rounded-lg border-l-2 border-[var(--copper)] bg-white/40 p-3 text-sm font-medium">{evaluationResult.recommendation}</p>
          )}

          {record && (
            <details className="mt-6 rounded-lg border hairline bg-white/35 p-4 text-sm">
              <summary className="cursor-pointer font-medium">决策审计记录</summary>
              <div className="mt-3 space-y-3 text-xs leading-5 text-[var(--muted)]">
                <Audit title="决策问题" content={record.question} />
                <Audit title="基准方案" content={record.baseline} />
                <Audit title="反对当前结论的证据" content={record.counterEvidence.join("；") || "无"} />
                <Audit title="失败条件" content={record.failureConditions.join("；")} />
                <Audit title="下一步" content={record.nextActions.join("；") || "保存当前假设快照，并在获得新证据后重新计算"} />
              </div>
            </details>
          )}
        </aside>
      </main>

      {listOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/25 p-4" onClick={() => setListOpen(false)}>
          <div className="surface w-full max-w-lg rounded-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">打开已保存项目</h2>
              <button aria-label="关闭" onClick={() => setListOpen(false)}><X size={16} /></button>
            </div>
            {listError && <p className="mt-3 text-sm text-[var(--red)]">{listError}</p>}
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {savedProjects.length === 0 && !listError && <p className="text-sm text-[var(--muted)]">还没有保存过项目。</p>}
              {savedProjects.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-lg border hairline bg-white/50 px-3 py-2 text-sm">
                  <div>
                    <b>{row.name}</b>
                    <p className="text-xs text-[var(--muted)]">{row.currency} · {new Date(row.updatedAt).toLocaleString("zh-CN")}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => void loadProject(row.id)}>打开</button>
                    <button aria-label={`删除 ${row.name}`} className="rounded-lg border hairline p-2 text-[var(--red)]" onClick={() => void deleteProject(row.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn-secondary mt-4 w-full text-sm" onClick={() => { setProject(defaultProject); setProjectId(null); setManualCsv(""); setDatedCsv(""); setListOpen(false); setSaveState("已新建空白项目（尚未保存）"); }}>
              新建空白项目
            </button>
          </div>
        </div>
      )}

      {marketOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMarketOpen(false)}>
          <aside className="absolute right-0 top-0 h-full w-full max-w-sm border-l hairline bg-[var(--paper-strong)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">假设依据 · 市场数据</h2>
              <button aria-label="关闭" onClick={() => setMarketOpen(false)}><X size={16} /></button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">外部数据只作为假设参考：参考汇率不是交易成交价，接口失败或数据过期时应以手工值为准。</p>
            <button className="btn-secondary mt-4 w-full text-sm" onClick={refreshMarket}><RefreshCw className="mr-2 inline" size={14} />获取 USD/CNY 参考汇率</button>
            {market.value !== undefined && (
              <div className="mt-4 rounded-lg border hairline bg-white/50 p-4 text-sm">
                <p className="num text-2xl font-semibold">{market.value}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{market.source}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">观察日期：{market.observedAt}{market.isStale ? "（数据已过期，请谨慎使用）" : ""}</p>
              </div>
            )}
            {market.error && <p className="mt-4 text-sm text-[var(--red)]">{market.error}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ index, title, icon, className = "" }: { index: string; title: string; icon: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between border-b hairline pb-3 ${className}`}>
      <div className="flex items-center gap-3"><span className="num text-xs text-[var(--copper)]">{index}</span><h2 className="font-semibold">{title}</h2></div>
      <span className="text-[var(--muted)]">{icon}</span>
    </div>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return <div className="p-4"><p className="label">{label}</p><p className="num text-lg font-semibold">{value}</p></div>;
}
function Metric({ label, value, tone, testId }: { label: string; value: string; tone?: "good" | "bad"; testId?: string }) {
  return (
    <div className="rounded-lg border hairline bg-white/35 p-3">
      <p className="label">{label}</p>
      <p data-testid={testId} className={`num mt-1 font-semibold ${tone === "good" ? "text-[var(--green)]" : tone === "bad" ? "text-[var(--red)]" : ""}`}>{value}</p>
    </div>
  );
}
function Audit({ title, content }: { title: string; content: string }) {
  return <div><b className="text-xs text-[var(--copper)]">{title}</b><p className="mt-1 text-[var(--muted)]">{content}</p></div>;
}
