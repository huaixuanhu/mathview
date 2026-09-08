import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  automaticDomain,
  defaultParameters,
  distributionById,
  distributions,
  formatCompact,
  sampleDistribution,
  supportLabel,
  validateParameters,
  type DistributionDefinition,
  type DistributionFamily,
  type ParameterValues,
} from "./lib/distributions";
import { calculateRisk, intervalProbability, tailSeries, type TailDirection } from "./lib/risk";

const Plot = lazy(() => import("./components/InteractivePlot"));
const ManifoldPage = lazy(() => import("./components/ManifoldPage"));

type AppMode = "one" | "two" | "risk" | "manifold";
type FunctionMode = "density" | "cdf";
type JointView = "heatmap" | "contour" | "surface";
type RiskView = "risk" | "tail";

interface DistributionState {
  id: string;
  parameters: ParameterValues;
}

interface PinnedCurve extends DistributionState {
  key: string;
}

const FAMILIES: DistributionFamily[] = ["Foundations", "Counts", "Waiting time", "Shape & scale", "Heavy tails", "Extreme values"];
const COLORS = ["#9badc1", "#b3a18e", "#92a99b", "#aba0b9", "#c08f8a"];

function readStoredDistribution(key: string, fallbackId: string): DistributionState {
  const fallbackDefinition = distributionById(fallbackId);
  const fallback = { id: fallbackDefinition.id, parameters: defaultParameters(fallbackDefinition) };
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as DistributionState | null;
    if (!parsed || !distributions.some((item) => item.id === parsed.id)) return fallback;
    const definition = distributionById(parsed.id);
    const values = { ...defaultParameters(definition), ...parsed.parameters };
    return validateParameters(definition, values).length ? fallback : { id: definition.id, parameters: values };
  } catch {
    return fallback;
  }
}

function useStoredDistribution(key: string, fallbackId: string) {
  const [state, setState] = useState<DistributionState>(() => readStoredDistribution(key, fallbackId));
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
    const timeout = window.setTimeout(() => {
      try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* The workspace still works without browser storage. */ }
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [key, state]);
  useEffect(() => {
    const flush = () => {
      try { window.localStorage.setItem(key, JSON.stringify(latest.current)); } catch { /* Storage may be unavailable. */ }
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [key]);
  return [state, setState] as const;
}

function readStoredMode(): AppMode {
  try {
    const value = window.localStorage.getItem("mathview-mode");
    return value === "two" || value === "risk" || value === "manifold" ? value : "one";
  } catch { return "one"; }
}

function App() {
  const [mode, setMode] = useState<AppMode>(readStoredMode);
  const [distributionMode, setDistributionMode] = useState<"one" | "two">(() => readStoredMode() === "two" ? "two" : "one");
  const [one, setOne] = useStoredDistribution("mathview-one", "normal");
  const [jointX, setJointX] = useStoredDistribution("mathview-joint-x", "normal");
  const [jointY, setJointY] = useStoredDistribution("mathview-joint-y", "normal");
  const [risk, setRisk] = useStoredDistribution("mathview-risk", "student-t");
  const [functionMode, setFunctionMode] = useState<FunctionMode>("density");
  const [jointFunction, setJointFunction] = useState<FunctionMode>("density");
  const [jointView, setJointView] = useState<JointView>("heatmap");
  const [riskView, setRiskView] = useState<RiskView>("risk");
  const [tailDirection, setTailDirection] = useState<TailDirection>("upper");
  const [confidence, setConfidence] = useState(0.95);
  const [rangeMode, setRangeMode] = useState<"auto" | "manual">("auto");
  const [manualDomain, setManualDomain] = useState<[number, number]>([-4, 4]);
  const [interval, setInterval] = useState<[number, number]>([-1, 1]);
  const [pinned, setPinned] = useState<PinnedCurve[]>([]);
  const [controlsOpen, setControlsOpen] = useState(false);

  const oneDefinition = distributionById(one.id);
  const xDefinition = distributionById(jointX.id);
  const yDefinition = distributionById(jointY.id);
  const riskDefinition = distributionById(risk.id);
  const oneErrors = validateParameters(oneDefinition, one.parameters);
  const jointErrors = [
    ...validateParameters(xDefinition, jointX.parameters).map((message) => `X: ${message}`),
    ...validateParameters(yDefinition, jointY.parameters).map((message) => `Y: ${message}`),
  ];
  const riskErrors = validateParameters(riskDefinition, risk.parameters);

  useEffect(() => {
    try { window.localStorage.setItem("mathview-mode", mode); } catch { /* Browser storage is optional. */ }
  }, [mode]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "show_probability_distribution",
        title: "Show probability distribution",
        description: "Open a named distribution in MathView 1D mode with optional numeric parameters and PDF/PMF or CDF view.",
        inputSchema: {
          type: "object",
          properties: {
            distributionId: { type: "string", enum: distributions.map((item) => item.id) },
            parameters: { type: "object", additionalProperties: { type: "number" } },
            function: { type: "string", enum: ["density", "cdf"] },
          },
          required: ["distributionId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object") throw new Error("Input must be an object.");
          const candidate = input as { distributionId?: unknown; parameters?: unknown; function?: unknown };
          if (typeof candidate.distributionId !== "string") throw new Error("distributionId is required.");
          const definition = distributions.find((item) => item.id === candidate.distributionId);
          if (!definition) throw new Error("Unknown distributionId.");
          const proposed = { ...defaultParameters(definition) };
          if (candidate.parameters && typeof candidate.parameters === "object") {
            for (const parameter of definition.parameters) {
              const value = (candidate.parameters as Record<string, unknown>)[parameter.key];
              if (value !== undefined) {
                if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${parameter.key} must be a finite number.`);
                proposed[parameter.key] = value;
              }
            }
          }
          const errors = validateParameters(definition, proposed);
          if (errors.length) throw new Error(errors.join(" "));
          setOne({ id: definition.id, parameters: proposed });
          setMode("one");
          setDistributionMode("one");
          setFunctionMode(candidate.function === "cdf" ? "cdf" : "density");
          return { distributionId: definition.id, parameters: proposed, function: candidate.function === "cdf" ? "cdf" : "density" };
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [setOne]);

  const automaticOneDomain = useMemo(
    () => (oneErrors.length ? ([-4, 4] as [number, number]) : automaticDomain(oneDefinition, one.parameters)),
    [oneDefinition, one.parameters, oneErrors.length],
  );
  const oneDomain = rangeMode === "manual" && manualDomain[1] > manualDomain[0] ? manualDomain : automaticOneDomain;
  const oneSeries = useMemo(
    () => (oneErrors.length ? { x: [], density: [], cdf: [] } : sampleDistribution(oneDefinition, one.parameters, oneDomain)),
    [oneDefinition, one.parameters, oneDomain, oneErrors.length],
  );
  const intervalResult = oneErrors.length ? Number.NaN : intervalProbability(oneDefinition, one.parameters, interval[0], interval[1]);

  const pinnedTraces = useMemo(() => pinned.flatMap((curve, index) => {
    const definition = distributionById(curve.id);
    if (validateParameters(definition, curve.parameters).length) return [];
    const sample = sampleDistribution(definition, curve.parameters);
    return [makeOneDimensionalTrace(definition, curve.parameters, sample, functionMode, COLORS[index + 1] ?? COLORS[1], 1.8, true)];
  }), [pinned, functionMode]);

  const onePlotData = useMemo(() => {
    const traces: any[] = [];
    traces.push(...pinnedTraces);

    const current = makeOneDimensionalTrace(oneDefinition, one.parameters, oneSeries, functionMode, COLORS[0], 2.4, false);
    if (functionMode === "density" && oneDefinition.kind === "continuous") {
      const selectedX = oneSeries.x.filter((x) => x >= interval[0] && x <= interval[1]);
      if (selectedX.length) {
        const selectedY = selectedX.map((x) => oneDefinition.density(x, one.parameters));
        traces.push({
          x: selectedX,
          y: selectedY,
          type: "scatter",
          mode: "lines",
          line: { color: "rgba(179,161,142,0.7)", width: 0 },
          fill: "tozeroy",
          fillcolor: "rgba(179,161,142,0.22)",
          hoverinfo: "skip",
          showlegend: false,
        });
      }
    }
    traces.push(current);
    return traces;
  }, [functionMode, interval, one.parameters, oneDefinition, oneSeries, pinnedTraces]);

  const jointGrid = useMemo(() => {
    if (mode !== "two" || jointErrors.length || xDefinition.kind !== yDefinition.kind) return null;
    const xSample = decimateSample(sampleDistribution(xDefinition, jointX.parameters, undefined, 68), 86);
    const ySample = decimateSample(sampleDistribution(yDefinition, jointY.parameters, undefined, 68), 86);
    const xValues = jointFunction === "density" ? xSample.density : xSample.cdf;
    const yValues = jointFunction === "density" ? ySample.density : ySample.cdf;
    return {
      x: xSample.x,
      y: ySample.x,
      z: yValues.map((yValue) => xValues.map((xValue) => xValue * yValue)),
    };
  }, [mode, jointErrors.length, jointFunction, jointX.parameters, jointY.parameters, xDefinition, yDefinition]);

  const jointPlotData = useMemo(() => {
    if (!jointGrid) return [];
    const common = {
      x: jointGrid.x,
      y: jointGrid.y,
      z: jointGrid.z,
      colorscale: [
        [0, "#1b1d21"],
        [0.25, "#3c4957"],
        [0.55, "#788b9a"],
        [0.8, "#b6c0bd"],
        [1, "#ded5c7"],
      ],
      colorbar: { title: jointFunction === "cdf" ? "Joint CDF" : xDefinition.kind === "discrete" ? "Joint PMF" : "Joint PDF", thickness: 13 },
      hovertemplate: "x = %{x:.4g}<br>y = %{y:.4g}<br>z = %{z:.6g}<extra></extra>",
    };
    if (jointView === "surface") return [{ ...common, type: "surface", showscale: true }];
    if (jointView === "contour") return [{ ...common, type: "contour", contours: { coloring: "heatmap", showlabels: false }, line: { color: "rgba(225,247,255,.28)", width: 1 } }];
    return [{ ...common, type: "heatmap", zsmooth: xDefinition.kind === "continuous" ? "best" : false }];
  }, [jointFunction, jointGrid, jointView, xDefinition.kind]);

  const riskResult = useMemo(
    () => (mode !== "risk" || riskErrors.length ? null : calculateRisk(riskDefinition, risk.parameters, confidence, tailDirection)),
    [mode, confidence, risk.parameters, riskDefinition, riskErrors.length, tailDirection],
  );
  const riskDomain = useMemo(() => {
    if (!riskResult) return [-4, 4] as [number, number];
    const domain = automaticDomain(riskDefinition, risk.parameters, Math.min(0.9995, Math.max(0.995, confidence)));
    const markers = [riskResult.valueAtRisk, riskResult.expectedShortfall].filter(Number.isFinite);
    if (!markers.length) return domain;
    const span = Math.max(1e-6, domain[1] - domain[0]);
    const lower = Math.min(domain[0], ...markers) - span * 0.035;
    const upper = Math.max(domain[1], ...markers) + span * 0.035;
    return [lower, upper] as [number, number];
  }, [confidence, risk.parameters, riskDefinition, riskResult]);
  const riskSample = useMemo(
    () => (mode !== "risk" || riskView !== "risk" || riskErrors.length ? { x: [], density: [], cdf: [] } : sampleDistribution(riskDefinition, risk.parameters, riskDomain)),
    [mode, riskView, riskDefinition, risk.parameters, riskDomain, riskErrors.length],
  );
  const regularTailSeries = useMemo(
    () => (mode !== "risk" || riskView !== "tail" || riskErrors.length ? { x: [], y: [], reference: undefined } : tailSeries(riskDefinition, risk.parameters)),
    [mode, riskView, riskDefinition, risk.parameters, riskErrors.length],
  );
  const riskPlot = useMemo(
    () => makeRiskPlot(riskDefinition, risk.parameters, riskSample, riskResult, tailDirection),
    [risk.parameters, riskDefinition, riskResult, riskSample, tailDirection],
  );

  const oneLayout = useMemo(() => {
    const base = cartesianLayout({
      xTitle: "x",
      yTitle: functionMode === "cdf" ? "F(x)" : oneDefinition.kind === "continuous" ? "Density" : "Mass",
      step: oneDefinition.kind === "discrete",
      uirevision: `${one.id}-${functionMode}-${rangeMode}-${rangeMode === "manual" ? manualDomain.join(":") : ""}`,
    });
    return rangeMode === "manual" && manualDomain[1] > manualDomain[0]
      ? { ...base, xaxis: { ...base.xaxis, range: [...manualDomain], autorange: false } }
      : base;
  }, [functionMode, one.id, oneDefinition.kind, rangeMode, manualDomain]);
  const jointChartLayout = useMemo(() => jointLayout(jointView, xDefinition, yDefinition, jointFunction), [jointView, xDefinition, yDefinition, jointFunction]);
  const riskChartLayout = useMemo(() => riskLayout(riskDefinition, riskResult, tailDirection, riskPlot.maxY), [riskDefinition, riskResult, tailDirection, riskPlot.maxY]);
  const tailChartLayout = useMemo(() => tailLayout(riskDefinition), [riskDefinition]);
  const tailData = useMemo(() => tailPlotData(riskDefinition, risk.parameters, regularTailSeries), [riskDefinition, risk.parameters, regularTailSeries]);

  const chooseOneDistribution = (id: string) => {
    const definition = distributionById(id);
    const parameters = defaultParameters(definition);
    setOne({ id, parameters });
    setRangeMode("auto");
    setPinned([]);
    const lower = definition.quantile(0.25, parameters);
    const upper = definition.quantile(0.75, parameters);
    setInterval([Number.isFinite(lower) ? lower : 0, Number.isFinite(upper) ? upper : 1]);
  };

  const chooseJointX = (id: string) => {
    const definition = distributionById(id);
    setJointX({ id, parameters: defaultParameters(definition) });
    if (definition.kind !== yDefinition.kind) {
      const compatible = distributions.find((item) => item.kind === definition.kind) ?? definition;
      setJointY({ id: compatible.id, parameters: defaultParameters(compatible) });
    }
  };

  const chooseJointY = (id: string) => {
    const definition = distributionById(id);
    setJointY({ id, parameters: defaultParameters(definition) });
  };

  const chooseRiskDistribution = (id: string) => {
    const definition = distributionById(id);
    setRisk({ id, parameters: defaultParameters(definition) });
  };

  const addPinnedCurve = () => {
    setPinned((current) => [
      ...current.slice(-3),
      { key: `${one.id}-${Date.now()}`, id: one.id, parameters: { ...one.parameters } },
    ]);
  };

  const useManualRange = () => {
    setManualDomain(automaticOneDomain);
    setRangeMode("manual");
  };

  const exportCsv = () => {
    if (!oneSeries.x.length) return;
    const densityLabel = oneDefinition.kind === "continuous" ? "pdf" : "pmf";
    const rows = [
      `x,${densityLabel},cdf`,
      ...oneSeries.x.map((x, index) => `${x},${oneSeries.density[index]},${oneSeries.cdf[index]}`),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mathview-${one.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">∿</div>
          <div>
            <div className="brand-name">MathView</div>
            <div className="brand-kicker">Probability &amp; Geometry Lab</div>
          </div>
        </div>
        <nav className="mode-tabs" aria-label="Visualization mode">
          <ModeButton active={mode === "one" || mode === "two"} label="概率分布" sublabel="Distribution" onClick={() => setMode(distributionMode)} />
          <ModeButton active={mode === "risk"} label="Tail" sublabel="VaR & ES" onClick={() => setMode("risk")} />
          <ModeButton active={mode === "manifold"} label="流形" sublabel="Manifold" onClick={() => setMode("manifold")} />
        </nav>
        <div className="workspace-caption">An interactive study of mathematics</div>
      </header>

      {mode === "manifold" ? <Suspense fallback={<div className="page-loading" role="status">正在载入流形工作区…</div>}><ManifoldPage /></Suspense> : <section className="workspace" data-controls-open={controlsOpen}>
        <button className="mobile-controls-toggle" type="button" aria-expanded={controlsOpen} aria-controls="visualization-controls" onClick={() => setControlsOpen((open) => !open)}>
          <span>Parameters <small>参数与区间</small></span><span>{controlsOpen ? "收起 −" : "展开 ＋"}</span>
        </button>
        <aside id="visualization-controls" className="control-panel" aria-label="Visualization controls">
          {(mode === "one" || mode === "two") && <div className="distribution-dimensions"><Segmented value={mode} options={[{ value: "one", label: "1D Distribution" }, { value: "two", label: "2D Joint" }]} onChange={(value) => { setMode(value as "one" | "two"); setDistributionMode(value as "one" | "two"); }} /></div>}
          {mode === "one" && (
            <>
              <PanelIdentity definition={oneDefinition} />
              <DistributionPicker value={one.id} onChange={chooseOneDistribution} />
              <PanelRule />
              <ParameterControls
                definition={oneDefinition}
                values={one.parameters}
                onChange={(key, value) => setOne((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }))}
              />
              <ValidationMessages messages={oneErrors} />
              <PanelRule />
              <div className="control-section-head">
                <div className="control-title">Range <small>显示区间</small></div>
                <Segmented
                  value={rangeMode}
                  options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Manual" }]}
                  onChange={(value) => (value === "manual" ? useManualRange() : setRangeMode("auto"))}
                />
              </div>
              {rangeMode === "manual" && (
                <div className="paired-inputs">
                  <LabeledNumber label="x min" value={manualDomain[0]} onChange={(value) => setManualDomain([value, manualDomain[1]])} />
                  <LabeledNumber label="x max" value={manualDomain[1]} onChange={(value) => setManualDomain([manualDomain[0], value])} />
                </div>
              )}
              <PanelRule />
              <div className="control-title">Interval probability <small>区间概率</small></div>
              <div className="paired-inputs">
                <LabeledNumber label="From" value={interval[0]} onChange={(value) => setInterval([value, interval[1]])} />
                <LabeledNumber label="To" value={interval[1]} onChange={(value) => setInterval([interval[0], value])} />
              </div>
              <div className="probability-readout"><span>P(a ≤ X ≤ b)<small>Selected area · 选中区间</small></span><strong>{formatProbability(intervalResult)}</strong></div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={addPinnedCurve} disabled={pinned.length >= 4 || !!oneErrors.length}>＋ Pin curve{pinned.length ? ` (${pinned.length}/4)` : ""}</button>
                <button className="ghost-button" type="button" onClick={() => setPinned([])} disabled={!pinned.length}>Clear {pinned.length || ""}</button>
              </div>
              <StatsGrid definition={oneDefinition} values={one.parameters} />
            </>
          )}

          {mode === "two" && (
            <>
              <div className="panel-heading">
                <span className="eyebrow">Independent joint model</span>
                <span className="formula-chip">fₓ(x) · fᵧ(y)</span>
              </div>
              <div className="joint-block">
                <div className="joint-axis-label"><span>X</span> First marginal</div>
                <DistributionPicker value={jointX.id} onChange={chooseJointX} label="X distribution" hideLabel />
                <ParameterControls
                  definition={xDefinition}
                  values={jointX.parameters}
                  compact
                  onChange={(key, value) => setJointX((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }))}
                />
              </div>
              <PanelRule />
              <div className="joint-block">
                <div className="joint-axis-label"><span>Y</span> Second marginal</div>
                <DistributionPicker value={jointY.id} onChange={chooseJointY} kind={xDefinition.kind} label="Y distribution" hideLabel />
                <ParameterControls
                  definition={yDefinition}
                  values={jointY.parameters}
                  compact
                  onChange={(key, value) => setJointY((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }))}
                />
              </div>
              <ValidationMessages messages={jointErrors} />
              <div className="model-note"><strong>Independence assumption</strong><span>X and Y use separate marginals. Mixed continuous/discrete pairs are excluded in this version.</span></div>
            </>
          )}

          {mode === "risk" && (
            <>
              <PanelIdentity definition={riskDefinition} tail />
              <DistributionPicker value={risk.id} onChange={chooseRiskDistribution} />
              <PanelRule />
              <ParameterControls
                definition={riskDefinition}
                values={risk.parameters}
                onChange={(key, value) => setRisk((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }))}
              />
              <ValidationMessages messages={riskErrors} />
              <PanelRule />
              <div className="control-section-head">
                <div className="control-title">Tail side <small>尾部方向</small></div>
                <Segmented
                  value={tailDirection}
                  options={[{ value: "upper", label: "Upper" }, { value: "lower", label: "Lower" }]}
                  onChange={(value) => setTailDirection(value as TailDirection)}
                />
              </div>
              <div className="parameter-block confidence-block">
                <div className="parameter-row">
                  <label htmlFor="confidence">Confidence <span>q</span></label>
                  <input
                    id="confidence"
                    className="number-input"
                    type="number"
                    min="0.8"
                    max="0.999"
                    step="0.001"
                    value={confidence}
                    onChange={(event) => setConfidence(clamp(Number(event.target.value), 0.8, 0.999))}
                  />
                </div>
                <input
                  className="range-input risk-range"
                  type="range"
                  min="0.8"
                  max="0.999"
                  step="0.001"
                  value={confidence}
                  aria-label="Confidence level"
                  onChange={(event) => setConfidence(Number(event.target.value))}
                />
              </div>
              {riskResult && <RiskReadout result={riskResult} />}
              <div className={`tail-classification is-${riskDefinition.tail(risk.parameters).classification}`}>
                <span>{riskDefinition.tail(risk.parameters).label}</span>
                <p>{riskDefinition.tail(risk.parameters).note}</p>
              </div>
            </>
          )}
        </aside>

        <section className="chart-panel" aria-label="Interactive visualization">
          {mode === "one" && (
            <>
              <ChartToolbar
                eyebrow={`${oneDefinition.name} · ${oneDefinition.chineseName}`}
                title={functionMode === "cdf" ? "Cumulative distribution" : oneDefinition.kind === "continuous" ? "Probability density" : "Probability mass"}
                controls={
                  <>
                    <Segmented
                      value={functionMode}
                      options={[{ value: "density", label: oneDefinition.kind === "continuous" ? "PDF" : "PMF" }, { value: "cdf", label: "CDF" }]}
                      onChange={(value) => setFunctionMode(value as FunctionMode)}
                    />
                    <button className="icon-button" type="button" onClick={exportCsv} title="Download chart points as CSV">CSV</button>
                  </>
                }
              />
              <PlotFrame error={oneErrors[0]}>
                <Suspense fallback={<PlotFallback />}>
                  <Plot
                    data={onePlotData as any}
                    layout={oneLayout as any}
                  />
                </Suspense>
              </PlotFrame>
              <div className="formula-strip">
                <div><span>Formula</span><code>{oneDefinition.formula}</code></div>
                <p>{oneDefinition.description}</p>
              </div>
              <ChartFooter left="拖动平移 · 滚轮缩放 · 双击图面复位 · 双击坐标轴单独复位" right={parameterSummary(oneDefinition, one.parameters)} />
            </>
          )}

          {mode === "two" && (
            <>
              <ChartToolbar
                eyebrow={`${xDefinition.name} × ${yDefinition.name}`}
                title={jointFunction === "cdf" ? "Joint cumulative distribution" : xDefinition.kind === "continuous" ? "Joint probability density" : "Joint probability mass"}
                controls={
                  <>
                    <Segmented
                      value={jointFunction}
                      options={[{ value: "density", label: xDefinition.kind === "continuous" ? "PDF" : "PMF" }, { value: "cdf", label: "CDF" }]}
                      onChange={(value) => setJointFunction(value as FunctionMode)}
                    />
                    <Segmented
                      value={jointView}
                      options={[{ value: "heatmap", label: "Heat" }, { value: "contour", label: "Contour" }, { value: "surface", label: "3D" }]}
                      onChange={(value) => setJointView(value as JointView)}
                    />
                  </>
                }
              />
              <PlotFrame error={jointErrors[0]}>
                <Suspense fallback={<PlotFallback />}>
                  <Plot
                    data={jointPlotData as any}
                    layout={jointChartLayout as any}
                  />
                </Suspense>
              </PlotFrame>
              <div className="formula-strip joint-formula-strip">
                <div><span>Joint rule</span><code>{jointFunction === "cdf" ? "Fₓ,ᵧ(x,y) = Fₓ(x) · Fᵧ(y)" : "fₓ,ᵧ(x,y) = fₓ(x) · fᵧ(y)"}</code></div>
                <p>Both marginals are user-defined and independent. Surface height or colour represents the joint value.</p>
              </div>
              <ChartFooter left={jointView === "surface" ? "拖动旋转 · 滚轮缩放 · Reset view 恢复视角" : "拖动平移 · 滚轮缩放 · 双击图面或坐标轴复位"} right={`${xDefinition.kind} pair`} />
            </>
          )}

          {mode === "risk" && (
            <>
              <ChartToolbar
                eyebrow={`${riskDefinition.name} · ${riskDefinition.chineseName}`}
                title={riskView === "risk" ? "Tail risk profile" : "Regular variation diagnostic"}
                controls={
                  <Segmented
                    value={riskView}
                    options={[{ value: "risk", label: "VaR & ES" }, { value: "tail", label: "Log-log tail" }]}
                    onChange={(value) => setRiskView(value as RiskView)}
                  />
                }
              />
              <PlotFrame error={riskErrors[0] || (riskView === "tail" && regularTailSeries.x.length < 2 ? "A positive upper-tail range is required for the log-log diagnostic." : undefined)}>
                <Suspense fallback={<PlotFallback />}>
                  {riskView === "risk" ? (
                    <Plot
                      data={riskPlot.data as any}
                      layout={riskChartLayout as any}
                    />
                  ) : (
                    <Plot
                      data={tailData as any}
                      layout={tailChartLayout as any}
                    />
                  )}
                </Suspense>
              </PlotFrame>
              <div className="formula-strip">
                <div><span>{riskView === "risk" ? "Convention" : "Diagnostic"}</span><code>{riskView === "risk" ? riskConvention(tailDirection, confidence) : "log S(x) against log x"}</code></div>
                <p>{riskView === "risk" ? "VaR is a tail quantile; ES is the average loss or return within the selected tail." : riskDefinition.tail(risk.parameters).note}</p>
              </div>
              <ChartFooter left={riskResult?.note ?? "Adjust the parameters to continue."} right={`q = ${formatProbability(confidence)}`} />
            </>
          )}
        </section>
      </section>}
    </main>
  );
}

function ModeButton({ active, label, sublabel, onClick }: { active: boolean; label: string; sublabel: string; onClick: () => void }) {
  return (
    <button className={`mode-tab ${active ? "is-active" : ""}`} type="button" onClick={onClick} aria-pressed={active}>
      <strong>{label}</strong><span>{sublabel}</span>
    </button>
  );
}

function PanelIdentity({ definition, tail = false }: { definition: DistributionDefinition; tail?: boolean }) {
  return (
    <div className="panel-heading">
      <span className="eyebrow">{tail ? "Tail analytics" : definition.kind}</span>
      <span className="formula-chip">{tail ? "q → tail" : definition.kind === "continuous" ? "f(x)" : "P(X=k)"}</span>
    </div>
  );
}

function DistributionPicker({
  value,
  onChange,
  kind,
  label,
  hideLabel = false,
}: {
  value: string;
  onChange: (value: string) => void;
  kind?: "continuous" | "discrete";
  label?: string;
  hideLabel?: boolean;
}) {
  const candidates = kind ? distributions.filter((item) => item.kind === kind) : distributions;
  return (
    <label className={hideLabel ? "picker-wrap compact-picker" : "picker-wrap"}>
      {!hideLabel && <span className="field-label">Distribution <small>分布</small></span>}
      <select className="select-control" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {FAMILIES.map((family) => {
          const items = candidates.filter((item) => item.family === family);
          return items.length ? (
            <optgroup key={family} label={family}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.chineseName}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
    </label>
  );
}

function ParameterControls({
  definition,
  values,
  onChange,
  compact = false,
}: {
  definition: DistributionDefinition;
  values: ParameterValues;
  onChange: (key: string, value: number) => void;
  compact?: boolean;
}) {
  const groupId = useId();
  return (
    <div className={compact ? "parameter-list is-compact" : "parameter-list"}>
      {!compact && <div className="control-title">Parameters <small>参数</small></div>}
      {definition.parameters.map((parameter) => {
        const dynamicMax = definition.id === "hypergeometric" && ["successes", "draws"].includes(parameter.key)
          ? Math.max(parameter.min, values.population)
          : parameter.max;
        return (
          <div className="parameter-block" key={parameter.key}>
            <div className="parameter-row">
              <label htmlFor={`${groupId}-${parameter.key}`}>{parameter.label} <span>{parameter.symbol}</span></label>
              <input
                id={`${groupId}-${parameter.key}`}
                className="number-input"
                type="number"
                min={parameter.min}
                max={dynamicMax}
                step={parameter.step}
                value={values[parameter.key]}
                onChange={(event) => onChange(parameter.key, Number(event.target.value))}
              />
            </div>
            <input
              className="range-input"
              type="range"
              min={parameter.min}
              max={dynamicMax}
              step={parameter.step}
              value={clamp(values[parameter.key], parameter.min, dynamicMax)}
              aria-label={`${definition.name} ${parameter.label}`}
              onChange={(event) => onChange(parameter.key, Number(event.target.value))}
            />
            {parameter.description && <div className="parameter-help">{parameter.description}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StatsGrid({ definition, values }: { definition: DistributionDefinition; values: ParameterValues }) {
  return (
    <div className="quick-stats">
      <div><span>Mean</span><strong>{formatCompact(definition.mean(values))}</strong></div>
      <div><span>Variance</span><strong>{formatCompact(definition.variance(values))}</strong></div>
      <div className="stat-wide"><span>Support</span><strong>{supportLabel(definition, values)}</strong></div>
    </div>
  );
}

function ValidationMessages({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <div className="validation-message" role="alert">{messages[0]}</div>;
}

function PanelRule() { return <div className="section-rule" />; }

function LabeledNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="small-number-field"><span>{label}</span><input type="number" value={roundInput(value)} step="any" onChange={(event) => onChange(Number(event.target.value))} /></label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? "is-active" : ""} onClick={() => onChange(option.value)} aria-pressed={value === option.value}>{option.label}</button>
      ))}
    </div>
  );
}

function RiskReadout({ result }: { result: ReturnType<typeof calculateRisk> }) {
  return (
    <div className="risk-readout">
      <div><span>VaR<sub>{formatProbability(result.confidence)}</sub></span><strong>{formatCompact(result.valueAtRisk)}</strong></div>
      <div><span>ES<sub>{formatProbability(result.confidence)}</sub>{result.approximate ? " ≈" : ""}</span><strong>{formatCompact(result.expectedShortfall)}</strong></div>
    </div>
  );
}

function ChartToolbar({ eyebrow, title, controls }: { eyebrow: string; title: string; controls: React.ReactNode }) {
  return (
    <div className="chart-toolbar">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
      <div className="chart-controls">{controls}</div>
    </div>
  );
}

function PlotFrame({ children, error }: { children: React.ReactNode; error?: string }) {
  return <div className="plot-wrap">{error ? <div className="plot-error" role="alert"><strong>Check parameters</strong><span>{error}</span></div> : children}</div>;
}

function PlotFallback() { return <div className="plot-fallback"><span /><p>Loading interactive chart…</p></div>; }

function ChartFooter({ left, right }: { left: string; right: string }) {
  return <footer className="chart-footer"><span>{left}</span><code>{right}</code></footer>;
}

function makeOneDimensionalTrace(
  definition: DistributionDefinition,
  parameters: ParameterValues,
  sample: ReturnType<typeof sampleDistribution>,
  mode: FunctionMode,
  color: string,
  width: number,
  pinned: boolean,
) {
  const name = `${definition.name} (${parameterSummary(definition, parameters)})`;
  if (mode === "density" && definition.kind === "discrete") {
    return {
      x: sample.x,
      y: sample.density,
      type: "bar",
      name,
      marker: { color, opacity: pinned ? 0.45 : 0.82, line: { color, width: 1 } },
      hovertemplate: `k = %{x}<br>PMF = %{y:.6g}<extra>${name}</extra>`,
    };
  }
  return {
    x: sample.x,
    y: mode === "density" ? sample.density : sample.cdf,
    type: "scatter",
    mode: "lines",
    name,
    line: { color, width, shape: definition.kind === "discrete" ? "hv" : "linear" },
    fill: pinned || mode === "cdf" ? "none" : "tozeroy",
    fillcolor: "rgba(155, 173, 193, 0.055)",
    hovertemplate: `x = %{x:.5g}<br>${mode === "cdf" ? "CDF" : "PDF"} = %{y:.6g}<extra>${name}</extra>`,
  };
}

function decimateSample(sample: ReturnType<typeof sampleDistribution>, maximum: number) {
  if (sample.x.length <= maximum) return sample;
  const stride = Math.ceil(sample.x.length / maximum);
  const indices = sample.x.map((_, index) => index).filter((index) => index % stride === 0 || index === sample.x.length - 1);
  return {
    x: indices.map((index) => sample.x[index]),
    density: indices.map((index) => sample.density[index]),
    cdf: indices.map((index) => sample.cdf[index]),
  };
}

function makeRiskPlot(
  definition: DistributionDefinition,
  parameters: ParameterValues,
  sample: ReturnType<typeof sampleDistribution>,
  result: ReturnType<typeof calculateRisk> | null,
  direction: TailDirection,
) {
  if (!result) return { data: [], maxY: 1 };
  const inTail = (x: number) => direction === "upper" ? x >= result.valueAtRisk : x <= result.valueAtRisk;
  const maxY = Math.max(0, ...sample.density.filter(Number.isFinite));
  if (definition.kind === "discrete") {
    return {
      data: [{
        x: sample.x,
        y: sample.density,
        type: "bar",
        marker: { color: sample.x.map((x) => inTail(x) ? "#c08f8a" : COLORS[0]), opacity: 0.86 },
        hovertemplate: "k = %{x}<br>PMF = %{y:.6g}<extra></extra>",
      }],
      maxY,
    };
  }
  const selectedX = sample.x.filter(inTail);
  const selectedY = selectedX.map((x) => definition.density(x, parameters));
  return {
    data: [
      {
        x: sample.x,
        y: sample.density,
        type: "scatter",
        mode: "lines",
        line: { color: COLORS[0], width: 2.4 },
        fill: "tozeroy",
        fillcolor: "rgba(155,173,193,.055)",
        hovertemplate: "x = %{x:.5g}<br>PDF = %{y:.6g}<extra></extra>",
      },
      {
        x: selectedX,
        y: selectedY,
        type: "scatter",
        mode: "lines",
        line: { color: "#c08f8a", width: 2 },
        fill: "tozeroy",
        fillcolor: "rgba(192,143,138,.2)",
        hovertemplate: "Tail x = %{x:.5g}<br>PDF = %{y:.6g}<extra></extra>",
      },
    ],
    maxY,
  };
}

function cartesianLayout({ xTitle, yTitle, step, uirevision }: { xTitle: string; yTitle: string; step?: boolean; uirevision: string }) {
  return {
    autosize: true,
    paper_bgcolor: "#1b1d21",
    plot_bgcolor: "#1b1d21",
    margin: { l: 62, r: 24, t: 62, b: 54 },
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.05, font: { size: 11, color: "#9a9fa8" }, bgcolor: "rgba(0,0,0,0)" },
    hovermode: "closest",
    hoverlabel: { bgcolor: "#292c32", bordercolor: "#50565f", font: { color: "#e4e3df", size: 12 } },
    dragmode: "pan",
    transition: { duration: 0 },
    bargap: step ? 0.2 : undefined,
    uirevision,
    font: plotFont(),
    xaxis: axisStyle(xTitle),
    yaxis: { ...axisStyle(yTitle), rangemode: "tozero" },
  };
}

function jointLayout(view: JointView, x: DistributionDefinition, y: DistributionDefinition, functionMode: FunctionMode) {
  const zTitle = functionMode === "cdf" ? "Joint CDF" : x.kind === "continuous" ? "Joint PDF" : "Joint PMF";
  const common = {
    autosize: true,
    paper_bgcolor: "#1b1d21",
    plot_bgcolor: "#1b1d21",
    margin: view === "surface" ? { l: 16, r: 20, t: 48, b: 18 } : { l: 62, r: 76, t: 52, b: 54 },
    font: plotFont(),
    uirevision: `${x.id}-${y.id}-${view}-${functionMode}`,
  };
  if (view === "surface") {
    return {
      ...common,
      scene: {
        bgcolor: "rgba(0,0,0,0)",
        xaxis: sceneAxis(`X · ${x.name}`),
        yaxis: sceneAxis(`Y · ${y.name}`),
        zaxis: sceneAxis(zTitle),
        camera: { eye: { x: 1.45, y: 1.45, z: 0.9 } },
      },
    };
  }
  return { ...common, dragmode: "pan", transition: { duration: 0 }, xaxis: axisStyle(`X · ${x.name}`), yaxis: axisStyle(`Y · ${y.name}`) };
}

function riskLayout(
  definition: DistributionDefinition,
  result: ReturnType<typeof calculateRisk> | null,
  direction: TailDirection,
  maxY: number,
) {
  const base = cartesianLayout({ xTitle: "x", yTitle: definition.kind === "continuous" ? "Density" : "Mass", step: definition.kind === "discrete", uirevision: `${definition.id}-${direction}` });
  if (!result) return base;
  const markerY = maxY * 0.92;
  const shapes: any[] = [{ type: "line", x0: result.valueAtRisk, x1: result.valueAtRisk, y0: 0, y1: 1, yref: "paper", line: { color: "#b3a18e", width: 1.5, dash: "dash" } }];
  const annotations: any[] = [{ x: result.valueAtRisk, y: markerY, text: "VaR", showarrow: true, arrowcolor: "#b3a18e", font: { color: "#d0c0ad" }, bgcolor: "#24262b", borderpad: 5 }];
  if (Number.isFinite(result.expectedShortfall)) {
    shapes.push({ type: "line", x0: result.expectedShortfall, x1: result.expectedShortfall, y0: 0, y1: 1, yref: "paper", line: { color: "#c08f8a", width: 1.5, dash: "dot" } });
    annotations.push({ x: result.expectedShortfall, y: markerY * 0.72, text: result.approximate ? "ES ≈" : "ES", showarrow: true, arrowcolor: "#c08f8a", font: { color: "#d0a4a0" }, bgcolor: "#24262b", borderpad: 5 });
  }
  return { ...base, shapes, annotations, showlegend: false };
}

function tailPlotData(
  definition: DistributionDefinition,
  parameters: ParameterValues,
  series: ReturnType<typeof tailSeries>,
) {
  const data: any[] = [{
    x: series.x,
    y: series.y,
    type: "scatter",
    mode: definition.kind === "discrete" ? "lines+markers" : "lines",
    name: "Survival S(x)",
    line: { color: COLORS[0], width: 2.4 },
    marker: { color: COLORS[0], size: 5 },
    hovertemplate: "x = %{x:.6g}<br>S(x) = %{y:.4e}<extra></extra>",
  }];
  if (series.reference) {
    data.push({
      x: series.x,
      y: series.reference,
      type: "scatter",
      mode: "lines",
      name: `Reference slope ${formatCompact(definition.tail(parameters).exponent ?? Number.NaN)}`,
      line: { color: "#b3a18e", width: 1.8, dash: "dash" },
      hoverinfo: "skip",
    });
  }
  return data;
}

function tailLayout(definition: DistributionDefinition) {
  return {
    ...cartesianLayout({ xTitle: "x · log scale", yTitle: "Survival S(x) · log scale", uirevision: `tail-${definition.id}` }),
    hovermode: "closest",
    xaxis: { ...axisStyle("x · log scale"), type: "log" },
    yaxis: { ...axisStyle("Survival S(x) · log scale"), type: "log" },
  };
}

function axisStyle(title: string) {
  return {
    title: { text: title, font: { color: "#a0a4ad", size: 11 } },
    gridcolor: "rgba(180,185,196,.08)",
    zerolinecolor: "rgba(180,185,196,.18)",
    tickfont: { color: "#959ba6", size: 11 },
    showspikes: false, // The independent overlay tracks the pointer across the entire plot.
    automargin: true,
  };
}

function sceneAxis(title: string) {
  return {
    title: { text: title, font: { color: "#a0a4ad", size: 11 } },
    color: "#959ba6",
    gridcolor: "rgba(180,185,196,.12)",
    zerolinecolor: "rgba(180,185,196,.22)",
    backgroundcolor: "rgba(27,29,33,.32)",
    showbackground: true,
  };
}

function plotFont() { return { color: "#acb0b8", family: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }; }

function parameterSummary(definition: DistributionDefinition, values: ParameterValues) {
  return definition.parameters.map((parameter) => `${parameter.symbol}=${formatCompact(values[parameter.key])}`).join(" · ");
}

function riskConvention(direction: TailDirection, confidence: number) {
  const q = formatProbability(confidence);
  return direction === "upper" ? `VaR${q} = Q(${q}); ES = E[X | X ≥ VaR]` : `Threshold = Q(${formatProbability(1 - confidence)}); ES = E[X | X ≤ threshold]`;
}

function formatProbability(value: number) {
  if (!Number.isFinite(value)) return "—";
  const percent = value * 100;
  const digits = percent < 0.01 ? 4 : percent < 1 ? 2 : 1;
  return `${percent.toFixed(digits).replace(/\.0+$/, "")}%`;
}

function roundInput(value: number) {
  return Number.isFinite(value) ? Number(value.toPrecision(8)) : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default App;
