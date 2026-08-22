"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BookOpenCheck, Check, ChevronRight,
  CircleDollarSign, Download, FileCheck2, Gauge, Landmark, RefreshCw, Save, Settings2, ShieldCheck, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { buildDecisionRecord, calculateReverseValuation, evaluateProject, type ProjectModel } from "@/lib/finance/appraisal";
import { defaultProject } from "@/lib/finance/default-project";
import { cashFlowsToCsv, decisionRecordToMarkdown, projectFromJson, projectToJson } from "@/lib/report/export";

const stages = ["定义决策", "商业验证", "隐藏成本", "收益驱动", "财务计算", "风险与决策"];

function formatMoney(value: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, notation: Math.abs(value) > 999999 ? "compact" : "standard", maximumFractionDigits: 0 }).format(value);
}
function formatPercent(value: number | null) { return value === null ? "无解" : `${(value * 100).toFixed(1)}%`; }

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (value: number) => void; suffix?: string }) {
  return <label><span className="label">{label}</span><div className="relative"><input aria-label={label} className="field num pr-12" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="absolute right-3 top-2.5 text-xs text-[var(--muted)]">{suffix}</span></div></label>;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function ProjectApp() {
  const [mode, setMode] = useState<"guide" | "workbench">("guide");
  const [stage, setStage] = useState(0);
  const [project, setProject] = useState<ProjectModel>(defaultProject);
  const [futureValue, setFutureValue] = useState(1_000_000);
  const [futureYear, setFutureYear] = useState(3);
  const [marketOpen, setMarketOpen] = useState(false);
  const [market, setMarket] = useState<{ value?: number; observedAt?: string; source?: string; isStale?: boolean; error?: string }>({});
  const [saveState, setSaveState] = useState("尚未保存");
  const [auditOpen, setAuditOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const evaluation = useMemo(() => evaluateProject(project), [project]);
  const record = useMemo(() => buildDecisionRecord(project, evaluation), [project, evaluation]);
  const reverse = useMemo(() => calculateReverseValuation({
    futureCashFlows: [{ period: futureYear, amount: futureValue }], minimumHurdleRate: project.discountRate,
    stretchReturnRate: project.stretchReturnRate, necessaryStartupCost: project.necessaryStartupCost,
    minimumOperatingCost: project.minimumOperatingCost, workingCapital: project.workingCapital,
    riskContingency: project.riskContingency, equityShare: 1,
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
  }, [evaluation.metrics.npv, reverse.valueCeiling, mode]);

  const update = <K extends keyof ProjectModel>(key: K, value: ProjectModel[K]) => setProject((current) => ({ ...current, [key]: value }));
  const updateRevenue = (key: keyof ProjectModel["revenue"], value: number) => setProject((current) => ({ ...current, revenue: { ...current.revenue, [key]: value } }));
  const cumulativeData = evaluation.cashFlows.reduce<{ period: string; cashFlow: number; cumulative: number }[]>((rows, cashFlow, index) => {
    rows.push({ period: index === 0 ? "现在" : `第${index}年`, cashFlow, cumulative: cashFlow + (rows.at(-1)?.cumulative ?? 0) }); return rows;
  }, []);

  async function saveProject() {
    setSaveState("保存中…");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
      if (!response.ok) throw new Error();
      setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    } catch { setSaveState("保存失败，请确认本地服务正在运行"); }
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

  function renderGuideContent() {
    if (stage === 0) return <div className="grid gap-5 md:grid-cols-2"><label><span className="label">项目名称</span><input className="field" value={project.name} onChange={(e) => update("name", e.target.value)} /></label><label><span className="label">你的角色</span><select className="field"><option>项目经营者</option><option>财务出资人</option><option>合作方</option></select></label><NumberField label="项目周期" value={project.periods} suffix="年" onChange={(v) => update("periods", Math.max(1, v))} /><label><span className="label">不做项目的基准方案</span><textarea className="field min-h-24" defaultValue="保留资金，并投入当前收益最高的其他选择" /></label></div>;
    if (stage === 1) return <div className="space-y-3">{project.assumptions.map((item) => <div key={item.name} className="grid gap-3 border-b hairline py-3 md:grid-cols-[1fr_.8fr_.8fr]"><div><p className="font-medium">{item.name}</p><p className="text-xs text-[var(--muted)]">{item.source} · {item.asOf}</p></div><span className="num">{item.value}</span><span className={`text-sm ${item.confidence === "low" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{item.status === "known" ? "已知" : item.status === "estimated" ? "估算" : "待验证"} · {item.confidence}</span></div>)}</div>;
    if (stage === 2) return <div className="space-y-3">{project.hiddenCosts.map((item, index) => <label key={item.name} className="flex items-center justify-between gap-4 border-b hairline py-3"><span><b className="font-medium">{item.name}</b><small className="ml-2 text-[var(--muted)]">{item.category}</small></span><span className="flex items-center gap-4"><span className="num">{formatMoney(item.amount)}</span><input type="checkbox" checked={item.included} onChange={(e) => update("hiddenCosts", project.hiddenCosts.map((cost, i) => i === index ? { ...cost, included: e.target.checked } : cost))} /></span></label>)}</div>;
    if (stage === 3) return <div className="grid gap-5 md:grid-cols-3"><NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" onChange={(v) => updateRevenue("prospects", v)} /><NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" onChange={(v) => updateRevenue("conversionRate", v / 100)} /><NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" onChange={(v) => updateRevenue("averageTicket", v)} /><NumberField label="年购买频次" value={project.revenue.frequency} suffix="次" onChange={(v) => updateRevenue("frequency", v)} /><NumberField label="收入年增长" value={project.revenue.annualGrowth * 100} suffix="%" onChange={(v) => updateRevenue("annualGrowth", v / 100)} /><NumberField label="变动成本率" value={project.variableCostRate * 100} suffix="%" onChange={(v) => update("variableCostRate", v / 100)} /></div>;
    if (stage === 4) return <div className="grid gap-5 md:grid-cols-3"><NumberField label="最低可接受回报率" value={project.discountRate * 100} suffix="%" onChange={(v) => update("discountRate", v / 100)} /><NumberField label="目标回报率" value={project.stretchReturnRate * 100} suffix="%" onChange={(v) => update("stretchReturnRate", v / 100)} /><NumberField label="税率" value={project.taxRate * 100} suffix="%" onChange={(v) => update("taxRate", v / 100)} /><div className="md:col-span-3 rounded-lg border border-[var(--line)] bg-white/40 p-4 text-sm"><b>口径校验通过：</b>当前使用名义现金流与名义折现率。系统不会把贷款利息与项目整体资金成本重复扣除。</div></div>;
    return <div className="grid gap-5 md:grid-cols-3"><Summary label="基准 NPV" value={formatMoney(evaluation.metrics.npv)} /><Summary label="基准 IRR" value={formatPercent(evaluation.metrics.irr)} /><Summary label="建议" value={evaluation.recommendation} /><div className="md:col-span-3 border-l-2 border-[var(--copper)] pl-4 text-sm text-[var(--muted)]">当前仍有 {project.hiddenCosts.filter((x) => !x.included).length} 项隐藏成本未计入、{project.assumptions.filter((x) => x.status === "unknown").length} 项假设待验证。进入工作台后可查看临界值与反证。</div></div>;
  }

  if (mode === "guide") return <div ref={rootRef} className="min-h-screen px-5 py-6 md:px-10 md:py-9"><header data-animate="header" className="mx-auto flex max-w-7xl items-center justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full border border-[var(--ink)]"><Landmark size={18} /></div><div><b className="tracking-[.12em]">衡策</b><p className="text-xs text-[var(--muted)]">PROJECT APPRAISAL</p></div></div><button className="btn-secondary" onClick={() => setMode("workbench")}>载入示例并进入工作台</button></header><main className="mx-auto mt-16 max-w-7xl"><div data-animate="section" className="max-w-3xl"><p className="eyebrow">Evidence before optimism</p><h1 className="mt-4 text-4xl font-semibold leading-tight md:text-6xl">先把项目问清楚，再谈回报</h1><p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">六个步骤把模糊想法转化为可审计的现金流、投资上限和失败条件。数字不会替你决定，但会告诉你决定依赖什么。</p></div><nav data-animate="section" aria-label="考察阶段" className="mt-12 grid gap-px overflow-hidden rounded-xl border hairline bg-[var(--line)] md:grid-cols-6">{stages.map((item, index) => <button key={item} onClick={() => setStage(index)} className={`min-h-20 bg-[var(--paper-strong)] px-4 text-left text-sm ${stage === index ? "text-[var(--copper)]" : "text-[var(--muted)]"}`}><span className="num block text-xs">{String(index + 1).padStart(2, "0")}</span><span className="mt-2 block font-medium">{item}</span></button>)}</nav><section data-animate="section" className="surface mt-6 rounded-xl p-6 md:p-9"><div className="mb-8 flex items-start justify-between border-b hairline pb-5"><div><span className="eyebrow">阶段 {stage + 1} / 6</span><h2 className="mt-2 text-2xl font-semibold">{stages[stage]}</h2></div><BookOpenCheck className="text-[var(--copper)]" /></div>{renderGuideContent()}<div className="mt-9 flex items-center justify-between"><button className="btn-secondary disabled:opacity-40" disabled={stage === 0} onClick={() => setStage((s) => s - 1)}><ArrowLeft className="mr-2 inline" size={15} />上一步</button>{stage < 5 ? <button className="btn-primary" onClick={() => setStage((s) => s + 1)}>下一步<ArrowRight className="ml-2 inline" size={15} /></button> : <button className="btn-primary" onClick={() => setMode("workbench")}>进入决策工作台<ChevronRight className="ml-2 inline" size={15} /></button>}</div></section></main></div>;

  return <div ref={rootRef} className="min-h-screen"><header data-animate="header" className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b hairline bg-[rgba(243,239,231,.92)] px-5 py-3 backdrop-blur-xl md:px-8"><div className="flex items-center gap-4"><button aria-label="返回考察向导" className="rounded-full border hairline p-2" onClick={() => setMode("guide")}><ArrowLeft size={16} /></button><div><p className="eyebrow">{project.name}</p><h1 className="text-xl font-semibold">决策工作台</h1></div></div><div className="flex items-center gap-2"><span className="hidden text-xs text-[var(--muted)] md:inline">{saveState}</span><button className="btn-secondary" onClick={() => setMarketOpen(true)}><Gauge className="mr-2 inline" size={15} />假设依据</button><button className="btn-primary" onClick={saveProject}><Save className="mr-2 inline" size={15} />保存项目</button></div></header><main className="grid min-h-[calc(100vh-70px)] lg:grid-cols-[.9fr_1.55fr_1fr]"><aside data-animate="section" className="border-r hairline p-5 md:p-6"><SectionTitle index="01" title="事实与证据" icon={<FileCheck2 size={16} />} /><div className="mt-5 space-y-3">{project.assumptions.map((item) => <div key={item.name} className="border-b hairline pb-3"><div className="flex justify-between gap-3"><b className="text-sm">{item.name}</b><span className={`text-xs ${item.confidence === "low" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{item.status === "unknown" ? "待验证" : item.status === "estimated" ? "估算" : "已知"}</span></div><p className="num mt-1 text-sm">{item.value}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.source} · {item.asOf}</p></div>)}</div><SectionTitle index="02" title="隐藏成本" icon={<ShieldCheck size={16} />} className="mt-9" /><div className="mt-4 space-y-2">{project.hiddenCosts.map((item, index) => <label key={item.name} className="flex items-center gap-3 rounded-lg border hairline bg-white/35 p-3"><input type="checkbox" checked={item.included} onChange={(e) => update("hiddenCosts", project.hiddenCosts.map((cost, i) => i === index ? { ...cost, included: e.target.checked } : cost))} /><span className="min-w-0 flex-1"><b className="block truncate text-xs">{item.name}</b><small className="text-[var(--muted)]">{item.category}</small></span><span className="num text-xs">{formatMoney(item.amount)}</span></label>)}</div><div className="mt-6 rounded-lg border border-[rgba(142,62,51,.25)] bg-[rgba(142,62,51,.05)] p-4 text-xs leading-5 text-[var(--red)]"><AlertTriangle className="mb-2" size={16} />沉没成本 {formatMoney(project.sunkCost)} 仅展示，不进入继续投资决策。</div></aside><section data-animate="section" className="border-r hairline bg-[rgba(255,253,248,.42)] p-5 md:p-7"><SectionTitle index="03" title="经营驱动与现金流" icon={<BarChart3 size={16} />} /><div className="mt-5 grid gap-4 sm:grid-cols-3"><NumberField label="潜在客户数" value={project.revenue.prospects} suffix="人" onChange={(v) => updateRevenue("prospects", v)} /><NumberField label="转化率" value={project.revenue.conversionRate * 100} suffix="%" onChange={(v) => updateRevenue("conversionRate", v / 100)} /><NumberField label="平均客单价" value={project.revenue.averageTicket} suffix="元" onChange={(v) => updateRevenue("averageTicket", v)} /></div><div className="mt-6 h-64 border-y hairline py-4"><ResponsiveContainer width="100%" height="100%"><AreaChart data={cumulativeData}><defs><linearGradient id="cash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a35f2c" stopOpacity={.28}/><stop offset="1" stopColor="#a35f2c" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ded7cb" strokeDasharray="2 4"/><XAxis dataKey="period" tick={{fontSize:11, fill:"#6f746e"}} axisLine={false}/><YAxis tick={{fontSize:10, fill:"#6f746e"}} tickFormatter={(v) => `${Math.round(v/1000)}k`} axisLine={false}/><Tooltip formatter={(v) => formatMoney(Number(v))}/><ReferenceLine y={0} stroke="#8e3e33"/><Area type="monotone" dataKey="cumulative" name="累计现金流" stroke="#a35f2c" fill="url(#cash)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div><div className="mt-8"><SectionTitle index="04" title="反向投资计算" icon={<CircleDollarSign size={16} />} /><p className="mt-2 text-sm text-[var(--muted)]">如果未来达到目标收益，今天的投入边界在哪里？</p><div className="mt-5 grid gap-4 sm:grid-cols-3"><NumberField label="未来净现金收益" value={futureValue} suffix="元" onChange={setFutureValue} /><NumberField label="实现时间" value={futureYear} suffix="年" onChange={(v) => setFutureYear(Math.max(1,v))} /><NumberField label="最低回报要求" value={project.discountRate * 100} suffix="%" onChange={(v) => update("discountRate", v / 100)} /></div><div className="mt-6 overflow-hidden rounded-lg border hairline"><div className="grid grid-cols-3 divide-x divide-[var(--line)] bg-white/45"><Summary label="最低可行投入" value={formatMoney(reverse.minimumViableInvestment)} /><Summary label="谈判报价下限" value={formatMoney(reverse.negotiationFloor)} /><Summary label="投资价值上限" value={formatMoney(reverse.valueCeiling)} /></div><div className={`px-4 py-3 text-sm ${reverse.feasible ? "bg-[rgba(49,91,72,.08)] text-[var(--green)]" : "bg-[rgba(142,62,51,.08)] text-[var(--red)]"}`}>{reverse.feasible ? `安全边际 ${formatMoney(reverse.safetyMargin)}。价值上限高于最低可行投入。` : `当前不可行：最低可行投入比价值上限高 ${formatMoney(-reverse.safetyMargin)}。`}</div></div></div><div className="mt-8 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => download(`${project.name}.json`, projectToJson(project), "application/json")}><Download className="mr-2 inline" size={14}/>JSON</button><button className="btn-secondary" onClick={() => download(`${project.name}-现金流.csv`, cashFlowsToCsv(evaluation.cashFlows), "text/csv")}><Download className="mr-2 inline" size={14}/>CSV</button><button className="btn-secondary" onClick={() => download(`${project.name}-决策审计.md`, decisionRecordToMarkdown(project, evaluation, record), "text/markdown")}><Download className="mr-2 inline" size={14}/>Markdown 报告</button><button className="btn-secondary" onClick={() => importRef.current?.click()}>导入 JSON</button><input ref={importRef} className="hidden" type="file" accept="application/json" onChange={async (e) => { const file=e.target.files?.[0]; if(file) setProject(projectFromJson(await file.text())); }} /></div></section><aside ref={resultRef} data-animate="section" className="p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">Deterministic verdict</p><h2 className="mt-2 text-3xl font-semibold">{evaluation.recommendation}</h2></div><span className={`grid h-10 w-10 place-items-center rounded-full ${evaluation.metrics.npv >= 0 ? "bg-[rgba(49,91,72,.1)] text-[var(--green)]" : "bg-[rgba(142,62,51,.1)] text-[var(--red)]"}`}>{evaluation.metrics.npv >= 0 ? <Check/> : <AlertTriangle/>}</span></div><div className="mt-6 border-y hairline py-5"><p className="label">净现值 NPV</p><p data-testid="npv-value" className="num text-4xl font-semibold">{formatMoney(evaluation.metrics.npv)}</p><div className="mt-4 grid grid-cols-2 gap-4"><Summary label="IRR" value={formatPercent(evaluation.metrics.irr)} /><Summary label="折现回收期" value={evaluation.metrics.discountedPaybackPeriod ? `${evaluation.metrics.discountedPaybackPeriod.toFixed(1)} 年` : "周期内未回收"} /></div></div><SectionTitle index="05" title="情景压力测试" icon={<Gauge size={16} />} className="mt-7" /><div className="mt-4 h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={evaluation.scenarios}><XAxis dataKey="name" tick={{fontSize:11}} axisLine={false}/><YAxis hide/><Tooltip formatter={(v) => formatMoney(Number(v))}/><Bar dataKey="npv" name="NPV" radius={[4,4,0,0]}>{evaluation.scenarios.map((item) => <Cell key={item.name} fill={item.npv >= 0 ? "#315b48" : "#8e3e33"}/>)}</Bar></BarChart></ResponsiveContainer></div><SectionTitle index="06" title="关键临界值" icon={<Settings2 size={16} />} className="mt-7" /><div className="mt-4 space-y-3">{evaluation.sensitivity.map((item) => <div key={item.variable} className="border-b hairline pb-3"><div className="flex justify-between text-sm"><b>{item.variable}</b><span className="num text-[var(--copper)]">{formatMoney(item.impact)}</span></div><p className="mt-1 text-xs text-[var(--muted)]">临界：{item.switchingValue}</p></div>)}</div><button className="mt-7 flex w-full items-center justify-between border-y hairline py-4 text-left" onClick={() => setAuditOpen(!auditOpen)}><span><span className="eyebrow">Decision audit</span><b className="mt-1 block">可审计解释</b></span><ChevronRight className={`transition-transform ${auditOpen ? "rotate-90" : ""}`} size={17}/></button>{auditOpen && <div className="space-y-5 py-5 text-sm leading-6"><Audit title="判断框架" content={record.framework}/><Audit title="最危险的假设" content={`${record.keySensitivity.variable}的变化对 NPV 影响最大；${record.keySensitivity.switchingValue} 是当前决策的翻转点。`}/><Audit title="反对当前结论的证据" content={record.counterEvidence.join("；") || "当前未录入反证，但这不等于不存在反证。"}/><Audit title="下一步" content={record.nextActions.join("；") || "保存假设快照，并在获得新证据后重新计算。"}/></div>}</aside></main>{marketOpen && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-end bg-black/20"><div className="h-full w-full max-w-md bg-[var(--paper-strong)] p-7 shadow-2xl"><div className="flex items-center justify-between"><div><p className="eyebrow">Assumption evidence</p><h2 className="mt-2 text-2xl font-semibold">市场与宏观依据</h2></div><button aria-label="关闭" onClick={() => setMarketOpen(false)}><X/></button></div><p className="mt-5 text-sm leading-6 text-[var(--muted)]">这些数据只用于支持折现率、通胀和汇率假设，不会自动替代你的项目判断。</p><div className="mt-8 rounded-lg border hairline p-5"><div className="flex items-center justify-between"><div><b>USD / CNY 参考汇率</b><p className="mt-1 text-xs text-[var(--muted)]">中央银行参考数据，非交易报价</p></div><button className="rounded-full border hairline p-2" onClick={refreshMarket}><RefreshCw size={15}/></button></div>{market.error && <p className="mt-4 text-sm text-[var(--red)]">{market.error}</p>}{market.value && <div className="mt-5"><p className="num text-3xl">{market.value}</p><p className="mt-2 text-xs text-[var(--muted)]">观察日 {market.observedAt} · {market.source} {market.isStale ? "· 数据可能过期" : "· 数据有效"}</p></div>}</div><div className="mt-5 rounded-lg border hairline p-5"><b>手工覆盖原则</b><p className="mt-2 text-sm leading-6 text-[var(--muted)]">外部数据不可用时可手工录入，但必须写明来源、观察日期和覆盖理由。系统不会静默使用未知旧值。</p></div></div></div>}</div>;
}

function SectionTitle({ index, title, icon, className = "" }: { index: string; title: string; icon: React.ReactNode; className?: string }) { return <div className={`flex items-center justify-between border-b hairline pb-3 ${className}`}><div className="flex items-center gap-3"><span className="num text-xs text-[var(--copper)]">{index}</span><h2 className="font-semibold">{title}</h2></div><span className="text-[var(--muted)]">{icon}</span></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="p-4"><p className="label">{label}</p><p className="num text-lg font-semibold">{value}</p></div>; }
function Audit({ title, content }: { title: string; content: string }) { return <div><b className="text-xs text-[var(--copper)]">{title}</b><p className="mt-1 text-[var(--muted)]">{content}</p></div>; }
