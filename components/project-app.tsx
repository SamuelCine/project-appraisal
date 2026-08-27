"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpenCheck, Dices, Download, FileCheck2, FolderOpen,
  Gauge, Landmark, Newspaper, Plus, Printer, RefreshCw, Save, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  buildDecisionRecord, calculateReverseValuation, evaluateProject,
  type Assumption, type DecisionRecord, type EvaluationResult, type HiddenCost, type ProjectModel,
} from "@/lib/finance/appraisal";
import { defaultProject } from "@/lib/finance/default-project";
import type { SimulationResult } from "@/lib/finance/simulate";
import type { StoredNewsItem } from "@/lib/db/repository";
import type { NewsKeyword } from "@/lib/news/keywords";
import { normalizeProjectModel } from "@/lib/finance/validate";
import type { DatedCashFlow } from "@/lib/finance/math";
import { cashFlowsToCsv, decisionRecordToMarkdown, parseCashFlowCsv, projectFromJson, projectToJson } from "@/lib/report/export";

const stages = ["定义决策", "商业验证", "隐藏成本", "收益驱动", "财务计算", "风险与决策"];

type SavedProjectRow = { id: string; name: string; currency: string; updatedAt: string };
type MarketState = { value?: number; observedAt?: string; source?: string; isStale?: boolean; error?: string };
type SimulationState = {
  loading: boolean;
  result: SimulationResult | null;
  interpretation: { text: string; source: string } | null;
  error: string;
};

function formatMoney(value: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency", currency,
    notation: Math.abs(value) > 999999 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatPercent(value: number | null) { return value === null ? "无解" : `${(value * 100).toFixed(1)}%`; }

function NumberField({ label, value, onChange, suffix, min, max }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; min?: number; max?: number }) {
  return (
    <label>
      <span className="label">{label}</span>
      <div className="relative">
        <input aria-label={label} className="field num pr-12" type="number" value={value} min={min} max={max} onChange={(event) => {
          const raw = Number(event.target.value);
          if (!Number.isFinite(raw)) return;
          onChange(min !== undefined && raw < min ? min : max !== undefined && raw > max ? max : raw);
        }} />
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

/** 假设编辑器：名称、数值、状态、可信度、来源、日期均可编辑，支持增删。 */
function AssumptionEditor({ items, onChange }: { items: Assumption[]; onChange: (items: Assumption[]) => void }) {
  const patch = (index: number, part: Partial<Assumption>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...part } : item)));
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-lg border hairline bg-white/35 p-3 md:grid-cols-[1.2fr_1fr_.9fr_.9fr_auto]">
          <input aria-label={`假设名称 ${index + 1}`} className="field !py-1.5 text-sm" value={item.name} onChange={(e) => patch(index, { name: e.target.value })} />
          <input aria-label={`假设数值 ${index + 1}`} className="field num !py-1.5 text-sm" value={item.value} onChange={(e) => patch(index, { value: e.target.value })} />
          <select aria-label={`假设状态 ${index + 1}`} className="field !py-1.5 text-sm" value={item.status} onChange={(e) => patch(index, { status: e.target.value as Assumption["status"] })}>
            <option value="known">已知</option><option value="estimated">估算</option><option value="unknown">待验证</option>
          </select>
          <select aria-label={`假设可信度 ${index + 1}`} className="field !py-1.5 text-sm" value={item.confidence} onChange={(e) => patch(index, { confidence: e.target.value as Assumption["confidence"] })}>
            <option value="high">可信度高</option><option value="medium">可信度中</option><option value="low">可信度低</option>
          </select>
          <button aria-label={`删除假设 ${index + 1}`} className="self-center rounded-lg border hairline p-2 text-[var(--red)]" onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
          <input aria-label={`假设来源 ${index + 1}`} className="field !py-1.5 text-xs md:col-span-2" placeholder="来源" value={item.source} onChange={(e) => patch(index, { source: e.target.value })} />
          <input aria-label={`假设日期 ${index + 1}`} type="date" className="field !py-1.5 text-xs" value={item.asOf} onChange={(e) => patch(index, { asOf: e.target.value })} />
        </div>
      ))}
      <button className="btn-secondary w-full text-sm" onClick={() => onChange([...items, { name: "新假设", value: "", status: "unknown", confidence: "low", source: "", asOf: new Date().toISOString().slice(0, 10) }])}>
        <Plus className="mr-1 inline" size={14} />添加假设
      </button>
    </div>
  );
}

/** 隐藏成本编辑器：名称、金额、分类、是否计入均可编辑，支持增删。 */
function HiddenCostEditor({ items, currency, onChange }: { items: HiddenCost[]; currency: string; onChange: (items: HiddenCost[]) => void }) {
  const patch = (index: number, part: Partial<HiddenCost>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...part } : item)));
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border hairline bg-white/35 p-3">
          <input type="checkbox" aria-label={`计入 ${item.name}`} checked={item.included} onChange={(e) => patch(index, { included: e.target.checked })} />
          <input aria-label={`成本名称 ${index + 1}`} className="field !w-40 !py-1.5 text-sm" value={item.name} onChange={(e) => patch(index, { name: e.target.value })} />
          <input aria-label={`成本金额 ${index + 1}`} type="number" min={0} className="field num !w-32 !py-1.5 text-sm" value={item.amount} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) patch(index, { amount: Math.max(0, v) }); }} />
          <input aria-label={`成本分类 ${index + 1}`} className="field !w-28 !py-1.5 text-xs" placeholder="分类" value={item.category} onChange={(e) => patch(index, { category: e.target.value })} />
          <span className="num text-xs text-[var(--muted)]">{formatMoney(item.amount, currency)}</span>
          <button aria-label={`删除成本 ${index + 1}`} className="ml-auto rounded-lg border hairline p-2 text-[var(--red)]" onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn-secondary w-full text-sm" onClick={() => onChange([...items, { name: "新成本项", amount: 0, included: false, category: "未分类" }])}>
        <Plus className="mr-1 inline" size={14} />添加隐藏成本
      </button>
    </div>
  );
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
  const [simState, setSimState] = useState<SimulationState>({ loading: false, result: null, interpretation: null, error: "" });
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsState, setNewsState] = useState<{
    loading: boolean;
    collecting: boolean;
    items: StoredNewsItem[];
    keywords: NewsKeyword[];
    message: string;
    error: string;
  }>({ loading: false, collecting: false, items: [], keywords: [], message: "", error: "" });
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // 服务端优先的评估：同一引擎模块，服务端是主路径；服务不可用时本地兜底。
  // 200ms 防抖，避免每敲一个数字就触发 80 次迭代的临界值二分。
  function computeLocal(model: ProjectModel): { result: EvaluationResult | null; record: DecisionRecord | null; error: string } {
    try {
      const result = evaluateProject(model);
      return { result, record: buildDecisionRecord(model, result), error: "" };
    } catch (error) {
      return { result: null, record: null, error: error instanceof Error ? error.message : "评估失败" };
    }
  }
  const [evalState, setEvalState] = useState(() => computeLocal(defaultProject));
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/projects/preview/evaluate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(project),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "评估失败");
        setEvalState({ result: body.evaluation as EvaluationResult, record: body.decisionRecord as DecisionRecord, error: "" });
      } catch {
        setEvalState(computeLocal(project));
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [project]);
  const evaluation = { result: evalState.result, error: evalState.error };
  const record = evalState.record;
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
  const updateSub = (key: keyof NonNullable<ProjectModel["subscription"]>, value: number) =>
    setProject((current) => ({ ...current, subscription: { ...(current.subscription ?? defaultProject.subscription!), [key]: value } }));

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

  // 蒙特卡洛风险模拟：服务端跑 1000 次扰动抽样，附 AI/规则解读。种子固定 42，结果可复现。
  async function runSimulation() {
    setSimState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/projects/preview/simulate?iterations=1000&explain=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(project),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "模拟失败");
      setSimState({ loading: false, result: body.simulation as SimulationResult, interpretation: body.interpretation ?? null, error: "" });
    } catch (error) {
      setSimState({ loading: false, result: null, interpretation: null, error: error instanceof Error ? error.message : "模拟失败，请确认本地服务正在运行" });
    }
  }

  // 新闻情报：读取当前项目的情报池与生长出的关键词；采集按钮触发 GDELT 抓取。
  async function openNews() {
    setNewsOpen(true);
    if (!projectId) return;
    setNewsState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/projects/${projectId}/news`);
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "读取失败");
      setNewsState((current) => ({ ...current, loading: false, items: body.items ?? [], keywords: body.keywords ?? [] }));
    } catch (error) {
      setNewsState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "读取新闻失败" }));
    }
  }

  async function refreshNews() {
    if (!projectId) return;
    setNewsState((current) => ({ ...current, collecting: true, message: "", error: "" }));
    try {
      const response = await fetch(`/api/projects/${projectId}/news/refresh`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "采集失败");
      const failed = (body.errors ?? []).length;
      setNewsState((current) => ({
        ...current,
        message: `本次新增 ${body.newItems} 条，情报池共 ${body.totalItems} 条${failed ? `；${failed} 个关键词采集失败` : ""}`,
      }));
      const listResponse = await fetch(`/api/projects/${projectId}/news`);
      const listBody = await listResponse.json();
      if (listResponse.ok) {
        setNewsState((current) => ({ ...current, items: listBody.items ?? [], keywords: listBody.keywords ?? [] }));
      }
    } catch (error) {
      setNewsState((current) => ({ ...current, error: error instanceof Error ? error.message : "采集失败，请检查网络后重试" }));
    } finally {
      setNewsState((current) => ({ ...current, collecting: false }));
    }
  }

  const histogramData = (simState.result?.histogram ?? []).map((bin) => ({
    label: formatMoney((bin.from + bin.to) / 2, project.currency),
    count: bin.count,
    negative: (bin.from + bin.to) / 2 < 0,
  }));

  const evaluationResult = evaluation.result;

  function renderGuideContent() {
    if (stage === 0) return (
      <div className="grid gap-5 md:grid-cols-2">
        <label><span className="label">项目名称</span><input className="field" value={project.name} onChange={(e) => update("name", e.target.value)} /></label>
        <label><span className="label">你的角色</span><select className="field" value={project.role ?? "项目经营者"} onChange={(e) => update("role", e.target.value)}><option>项目经营者</option><option>财务出资人</option><option>合作方</option></select></label>
        <NumberField label="项目周期" value={project.periods} suffix="年" onChange={(v) => update("periods", Math.max(1, Math.round(v || 1)))} />
        <label><span className="label">币种</span><select className="field" value={project.currency} onChange={(e) => update("currency", e.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option><option value="HKD">HKD 港币</option></select></label>
        <label className="md:col-span-2"><span className="label">不做项目的基准方案</span><textarea className="field min-h-24" value={project.baseline ?? ""} placeholder="保留资金，并投入当前收益最高的其他选择" onChange={(e) => update("baseline", e.target.value)} /></label>
      </div>
    );
    if (stage === 1) return (
      <AssumptionEditor items={project.assumptions} onChange={(items) => update("assumptions", items)} />
    );
    if (stage === 2) return (
      <HiddenCostEditor items={project.hiddenCosts} currency={project.currency} onChange={(items) => update("hiddenCosts", items)} />
    );
    if (stage === 3) return (
      <div className="space-y-5">
        <label className="block max-w-xs">
          <span className="label">收益模型</span>
          <select className="field" value={project.revenueModel ?? "generic"} onChange={(e) => update("revenueModel", e.target.value as ProjectModel["revenueModel"])}>
            <option value="generic">通用客户驱动</option>
            <option value="subscription">订阅模型</option>
          </select>
        </label>
        {(project.revenueModel ?? "generic") === "subscription" && project.subscription ? (
          <div className="grid gap-5 md:grid-cols-3">
            <NumberField label="每期新增客户" value={project.subscription.newCustomersPerPeriod} suffix="人" min={0} onChange={(v) => updateSub("newCustomersPerPeriod", v)} />
            <NumberField label="期流失率" value={project.subscription.churnRate * 100} suffix="%" min={0} max={100} onChange={(v) => updateSub("churnRate", v / 100)} />
            <NumberField label="ARPU（每期）" value={project.subscription.arpu} suffix="元" min={0} onChange={(v) => updateSub("arpu", v)} />
            <NumberField label="获客成本 CAC" value={project.subscription.cac} suffix="元" min={0} onChange={(v) => updateSub("cac", v)} />
            <NumberField label="单客户服务成本" value={project.subscription.serviceCostPerUser} suffix="元" min={0} onChange={(v) => updateSub("serviceCostPerUser", v)} />
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            <NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" min={0} onChange={(v) => updateRevenue("prospects", v)} />
            <NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" min={0} max={100} onChange={(v) => updateRevenue("conversionRate", v / 100)} />
            <NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" min={0} onChange={(v) => updateRevenue("averageTicket", v)} />
            <NumberField label="年购买频次" value={project.revenue.frequency} suffix="次" min={0} onChange={(v) => updateRevenue("frequency", v)} />
            <NumberField label="收入年增长" value={project.revenue.annualGrowth * 100} suffix="%" min={-100} onChange={(v) => updateRevenue("annualGrowth", v / 100)} />
            <NumberField label="变动成本率" value={project.variableCostRate * 100} suffix="%" min={0} max={100} onChange={(v) => update("variableCostRate", v / 100)} />
          </div>
        )}
      </div>
    );
    if (stage === 4) return (
      <div className="space-y-6">
        <div className="grid gap-5 md:grid-cols-3">
          <NumberField label="最低可接受回报率" value={project.discountRate * 100} suffix="%" min={0} onChange={(v) => update("discountRate", v / 100)} />
          <NumberField label="目标回报率" value={project.stretchReturnRate * 100} suffix="%" min={0} onChange={(v) => update("stretchReturnRate", v / 100)} />
          <NumberField label="税率" value={project.taxRate * 100} suffix="%" min={0} max={100} onChange={(v) => update("taxRate", v / 100)} />
          <NumberField label="必要启动成本" value={project.necessaryStartupCost} suffix="元" min={0} onChange={(v) => update("necessaryStartupCost", v)} />
          <NumberField label="最低运营成本" value={project.minimumOperatingCost} suffix="元" min={0} onChange={(v) => update("minimumOperatingCost", v)} />
          <NumberField label="营运资金" value={project.workingCapital} suffix="元" min={0} onChange={(v) => update("workingCapital", v)} />
          <NumberField label="风险预备金" value={project.riskContingency} suffix="元" min={0} onChange={(v) => update("riskContingency", v)} />
          <NumberField label="年固定运营成本" value={project.annualFixedOperatingCost} suffix="元" min={0} onChange={(v) => update("annualFixedOperatingCost", v)} />
          <NumberField label="期末残值" value={project.terminalValue} suffix="元" min={0} onChange={(v) => update("terminalValue", v)} />
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
          <button className="btn-secondary" onClick={() => void openNews()}><Newspaper className="mr-2 inline" size={15} />新闻情报</button>
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
          <button className="btn-secondary" onClick={() => window.print()}><Printer className="mr-2 inline" size={15} />打印 / PDF</button>
          <button className="btn-primary" onClick={saveProject}><Save className="mr-2 inline" size={15} />保存项目</button>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-70px)] lg:grid-cols-[.9fr_1.55fr_1fr]">
        <aside data-animate="section" className="border-r hairline p-5 md:p-6">
          <SectionTitle index="01" title="事实与证据" icon={<FileCheck2 size={16} />} />
          <div className="mt-5">
            <AssumptionEditor items={project.assumptions} onChange={(items) => update("assumptions", items)} />
          </div>
          <SectionTitle index="02" title="隐藏成本" icon={<ShieldCheck size={16} />} className="mt-9" />
          <div className="mt-4">
            <HiddenCostEditor items={project.hiddenCosts} currency={project.currency} onChange={(items) => update("hiddenCosts", items)} />
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
          <label className="mt-4 block max-w-xs">
            <span className="label">收益模型</span>
            <select className="field !py-1.5 text-sm" value={project.revenueModel ?? "generic"} onChange={(e) => update("revenueModel", e.target.value as ProjectModel["revenueModel"])}>
              <option value="generic">通用客户驱动</option>
              <option value="subscription">订阅模型</option>
            </select>
          </label>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {(project.revenueModel ?? "generic") === "subscription" && project.subscription ? (
              <>
                <NumberField label="每期新增客户" value={project.subscription.newCustomersPerPeriod} suffix="人" min={0} onChange={(v) => updateSub("newCustomersPerPeriod", v)} />
                <NumberField label="期流失率" value={project.subscription.churnRate * 100} suffix="%" min={0} max={100} onChange={(v) => updateSub("churnRate", v / 100)} />
                <NumberField label="ARPU（每期）" value={project.subscription.arpu} suffix="元" min={0} onChange={(v) => updateSub("arpu", v)} />
                <NumberField label="获客成本 CAC" value={project.subscription.cac} suffix="元" min={0} onChange={(v) => updateSub("cac", v)} />
                <NumberField label="单客户服务成本" value={project.subscription.serviceCostPerUser} suffix="元" min={0} onChange={(v) => updateSub("serviceCostPerUser", v)} />
              </>
            ) : (
              <>
                <NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" min={0} onChange={(v) => updateRevenue("prospects", v)} />
                <NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" min={0} max={100} onChange={(v) => updateRevenue("conversionRate", v / 100)} />
                <NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" min={0} onChange={(v) => updateRevenue("averageTicket", v)} />
                <NumberField label="年购买频次" value={project.revenue.frequency} suffix="次" min={0} onChange={(v) => updateRevenue("frequency", v)} />
                <NumberField label="收入年增长" value={project.revenue.annualGrowth * 100} suffix="%" min={-100} onChange={(v) => updateRevenue("annualGrowth", v / 100)} />
                <NumberField label="变动成本率" value={project.variableCostRate * 100} suffix="%" min={0} max={100} onChange={(v) => update("variableCostRate", v / 100)} />
              </>
            )}
            <NumberField label="年固定运营成本" value={project.annualFixedOperatingCost} suffix="元" min={0} onChange={(v) => update("annualFixedOperatingCost", v)} />
            <NumberField label="必要启动成本" value={project.necessaryStartupCost} suffix="元" min={0} onChange={(v) => update("necessaryStartupCost", v)} />
            <NumberField label="税率" value={project.taxRate * 100} suffix="%" min={0} max={100} onChange={(v) => update("taxRate", v / 100)} />
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

          <SectionTitle index="09" title="风险分布模拟" icon={<Dices size={16} />} className="mt-8" />
          <div className="mt-4 rounded-xl border hairline bg-white/40 p-4">
            <p className="text-xs leading-5 text-[var(--muted)]">
              对收入、成本与投产延迟做 1000 次扰动抽样，给出 NPV 分布、按期回收概率与破产线。种子固定（42），同一项目结果可复现；数字由确定性引擎产生，AI 只负责解读。
            </p>
            <button className="btn-primary mt-3 w-full text-sm disabled:opacity-50" disabled={simState.loading || !evaluationResult} onClick={() => void runSimulation()}>
              <Dices className="mr-2 inline" size={15} />{simState.loading ? "模拟中…" : simState.result ? "重新运行 1000 次模拟" : "运行 1000 次模拟"}
            </button>
            {simState.error && <p className="mt-3 flex items-center gap-2 text-sm text-[var(--red)]"><AlertTriangle size={14} />{simState.error}</p>}
            {simState.result && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Metric label="NPV P10（悲观）" value={formatMoney(simState.result.npv.p10, project.currency)} tone={simState.result.npv.p10 >= 0 ? "good" : "bad"} />
                  <Metric label="NPV P50（中位）" value={formatMoney(simState.result.npv.p50, project.currency)} tone={simState.result.npv.p50 >= 0 ? "good" : "bad"} />
                  <Metric label="NPV P90（乐观）" value={formatMoney(simState.result.npv.p90, project.currency)} tone={simState.result.npv.p90 >= 0 ? "good" : "bad"} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Metric label="亏损概率" value={formatPercent(simState.result.probNpvNegative)} tone={simState.result.probNpvNegative > 0.4 ? "bad" : undefined} />
                  <Metric label="按期回收概率" value={formatPercent(simState.result.probPaybackWithinPeriods)} />
                  <Metric
                    label="资金耗尽概率"
                    value={formatPercent(simState.result.insolvency.probability)}
                    tone={simState.result.insolvency.probability > 0.1 ? "bad" : undefined}
                  />
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="label" fontSize={10} interval={4} angle={-20} textAnchor="end" height={44} />
                      <YAxis fontSize={11} width={36} />
                      <Tooltip formatter={(v) => [`${v} 次`, "出现次数"]} />
                      <Bar dataKey="count" name="出现次数" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {histogramData.map((row) => <Cell key={row.label} fill={row.negative ? "var(--red)" : "var(--green)"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {simState.interpretation && (
                  <div className="rounded-lg border-l-2 border-[var(--copper)] bg-white/50 p-3">
                    <div className="flex items-center justify-between">
                      <b className="text-xs text-[var(--copper)]">分布解读</b>
                      <span className="rounded-full border hairline px-2 py-0.5 text-[10px] text-[var(--muted)]">
                        {simState.interpretation.source === "rules" ? "规则模式" : `AI · ${simState.interpretation.source}`}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-xs leading-5 text-[var(--muted)]">{simState.interpretation.text}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <SectionTitle index="10" title="敏感性与临界值" icon={<Gauge size={16} />} className="mt-8" />
          <div className="mt-4 space-y-3">
            {evaluationResult?.sensitivity.map((item) => (
              <div key={item.variable} className="border-b hairline pb-3 text-sm">
                <div className="flex justify-between"><b>{item.variable}</b><span className="num text-xs text-[var(--muted)]">影响 {formatMoney(item.impact, project.currency)}</span></div>
                <p className="mt-1 text-xs text-[var(--muted)]">临界值：{item.switchingValue}</p>
              </div>
            ))}
          </div>

          <SectionTitle index="11" title="决策建议" icon={<Gauge size={16} />} className="mt-8" />
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

      {newsOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNewsOpen(false)}>
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l hairline bg-[var(--paper-strong)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">新闻情报</h2>
              <button aria-label="关闭" onClick={() => setNewsOpen(false)}><X size={16} /></button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              按项目自动生长关键词，从 GDELT（全球新闻实时索引，免费）抓取相关报道。每条新闻保留链接与来源，后续预测会把它们作为风险证据引用。
            </p>
            {!projectId ? (
              <p className="mt-4 rounded-lg border border-[var(--copper-soft)] bg-[var(--copper-soft)]/40 p-3 text-sm">
                请先<b>保存项目</b>，情报池挂在已保存项目上，不同项目各自积累自己的新闻。
              </p>
            ) : (
              <>
                <button className="btn-primary mt-4 w-full text-sm disabled:opacity-50" disabled={newsState.collecting} onClick={() => void refreshNews()}>
                  <RefreshCw className={`mr-2 inline ${newsState.collecting ? "animate-spin" : ""}`} size={14} />
                  {newsState.collecting ? "采集中（约十几秒）…" : "立即采集最新新闻"}
                </button>
                {newsState.message && <p className="mt-3 text-sm text-[var(--green)]">{newsState.message}</p>}
                {newsState.error && <p className="mt-3 flex items-center gap-2 text-sm text-[var(--red)]"><AlertTriangle size={14} />{newsState.error}</p>}
                {newsState.keywords.length > 0 && (
                  <div className="mt-4">
                    <b className="text-xs text-[var(--copper)]">当前关键词（自动生长，可审计）</b>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {newsState.keywords.map((keyword) => (
                        <span key={keyword.term} title={keyword.origin} className="rounded-full border hairline bg-white/50 px-2 py-1 text-[11px] text-[var(--muted)]">
                          {keyword.term}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-2">
                  {newsState.loading && <p className="text-sm text-[var(--muted)]">读取中…</p>}
                  {!newsState.loading && newsState.items.length === 0 && !newsState.error && (
                    <p className="text-sm text-[var(--muted)]">情报池还是空的，点上方按钮开始第一次采集。</p>
                  )}
                  {newsState.items.map((item) => (
                    <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg border hairline bg-white/50 p-3 transition hover:border-[var(--copper)]">
                      <p className="text-sm font-medium leading-5">{item.title}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                        <span>{item.domain}</span>
                        <span>·</span>
                        <span>{new Date(item.publishedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="rounded-full border hairline px-1.5 py-0.5">{item.keyword}</span>
                      </p>
                    </a>
                  ))}
                </div>
              </>
            )}
          </aside>
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
