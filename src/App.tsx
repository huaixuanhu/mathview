import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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

const Plot = lazy(() => import("react-plotly.js"));

type AppMode = "one" | "two" | "risk";
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
const COLORS = ["#55e6d2", "#77a7ff", "#ffb76b", "#d38cff", "#f46f82"];
const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
  toImageButtonOptions: { format: "png", filename: "mathview-chart", scale: 2 },
} as const;

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
  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState] as const;
}

function App() {
  const [mode, setMode] = useState<AppMode>(() => (window.localStorage.getItem("mathview-mode") as AppMode | null) ?? "one");
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
    window.localStorage.setItem("mathview-mode", mode);
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

  const onePlotData = useMemo(() => {
    const traces: any[] = [];
    pinned.forEach((curve, index) => {
      const definition = distributionById(curve.id);
      if (validateParameters(definition, curve.parameters).length) return;
      const sample = sampleDistribution(definition, curve.parameters);
      traces.push(makeOneDimensionalTrace(definition, curve.parameters, sample, functionMode, COLORS[index + 1] ?? COLORS[1], 1.8, true));
    });

    const current = makeOneDimensionalTrace(oneDefinition, one.parameters, oneSeries, functionMode, COLORS[0], 3, false);
    if (functionMode === "density" && oneDefinition.kind === "continuous") {
      const selectedX = oneSeries.x.filter((x) => x >= interval[0] && x <= interval[1]);
      if (selectedX.length) {
        const selectedY = selectedX.map((x) => oneDefinition.density(x, one.parameters));
        traces.push({
          x: selectedX,
          y: selectedY,
          type: "scatter",
          mode: "lines",
          line: { color: "rgba(255,183,107,0.75)", width: 1 },
          fill: "tozeroy",
          fillcolor: "rgba(255,183,107,0.22)",
          hoverinfo: "skip",
          showlegend: false,
        });
      }
    }
    traces.push(current);
    return traces;
  }, [functionMode, interval, one.parameters, oneDefinition, oneSeries, pinned]);

  const jointGrid = useMemo(() => {
    if (jointErrors.length || xDefinition.kind !== yDefinition.kind) return null;
    const xSample = decimateSample(sampleDistribution(xDefinition, jointX.parameters, undefined, 68), 86);
    const ySample = decimateSample(sampleDistribution(yDefinition, jointY.parameters, undefined, 68), 86);
    const xValues = jointFunction === "density" ? xSample.density : xSample.cdf;
    const yValues = jointFunction === "density" ? ySample.density : ySample.cdf;
    return {
      x: xSample.x,
      y: ySample.x,
      z: yValues.map((yValue) => xValues.map((xValue) => xValue * yValue)),
    };
  }, [jointErrors.length, jointFunction, jointX.parameters, jointY.parameters, xDefinition, yDefinition]);

  const jointPlotData = useMemo(() => {
    if (!jointGrid) return [];
    const common = {
      x: jointGrid.x,
      y: jointGrid.y,
      z: jointGrid.z,
      colorscale: [
        [0, "#07111d"],
        [0.25, "#12344a"],
        [0.55, "#187e89"],
        [0.8, "#55e6d2"],
        [1, "#fff2bf"],
      ],
      colorbar: { title: jointFunction === "cdf" ? "Joint CDF" : xDefinition.kind === "discrete" ? "Joint PMF" : "Joint PDF", thickness: 13 },
      hovertemplate: "x = %{x:.4g}<br>y = %{y:.4g}<br>z = %{z:.6g}<extra></extra>",
    };
    if (jointView === "surface") return [{ ...common, type: "surface", showscale: true }];
    if (jointView === "contour") return [{ ...common, type: "contour", contours: { coloring: "heatmap", showlabels: false }, line: { color: "rgba(225,247,255,.28)", width: 1 } }];
    return [{ ...common, type: "heatmap", zsmooth: xDefinition.kind === "continuous" ? "best" : false }];
  }, [jointFunction, jointGrid, jointView, xDefinition.kind]);

  const riskResult = useMemo(
    () => (riskErrors.length ? null : calculateRisk(riskDefinition, risk.parameters, confidence, tailDirection)),
    [confidence, risk.parameters, riskDefinition, riskErrors.length, tailDirection],
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
    () => (riskErrors.length ? { x: [], density: [], cdf: [] } : sampleDistribution(riskDefinition, risk.parameters, riskDomain)),
    [riskDefinition, risk.parameters, riskDomain, riskErrors.length],
  );
  const regularTailSeries = useMemo(
    () => (riskErrors.length ? { x: [], y: [], reference: undefined } : tailSeries(riskDefinition, risk.parameters)),
    [riskDefinition, risk.parameters, riskErrors.length],
  );
  const riskPlot = useMemo(
    () => makeRiskPlot(riskDefinition, risk.parameters, riskSample, riskResult, tailDirection),
    [risk.parameters, riskDefinition, riskResult, riskSample, tailDirection],
  );

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
            <div className="brand-kicker">Probability &amp; Tail Lab</div>
          </div>
        </div>
        <nav className="mode-tabs" aria-label="Visualization mode">
          <ModeButton active={mode === "one"} label="1D" sublabel="Distribution" onClick={() => setMode("one")} />
          <ModeButton active={mode === "two"} label="2D" sublabel="Joint" onClick={() => setMode("two")} />
          <ModeButton active={mode === "risk"} label="Tail" sublabel="VaR & ES" onClick={() => setMode("risk")} />
        </nav>
        <div className="status-pill"><span /> Browser compute</div>
      </header>

      <section className="workspace">
        <aside className="control-panel" aria-label="Visualization controls">
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
              <div className="control-title top-gap">Interval probability <small>区间概率</small></div>
              <div className="paired-inputs">
                <LabeledNumber label="From" value={interval[0]} onChange={(value) => setInterval([value, interval[1]])} />
                <LabeledNumber label="To" value={interval[1]} onChange={(value) => setInterval([interval[0], value])} />
              </div>
              <div className="probability-readout">P(a ≤ X ≤ b)<strong>{formatProbability(intervalResult)}</strong></div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={addPinnedCurve} disabled={pinned.length >= 4 || !!oneErrors.length}>Pin curve</button>
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
                <DistributionPicker value={jointX.id} onChange={chooseJointX} hideLabel />
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
                <DistributionPicker value={jointY.id} onChange={chooseJointY} kind={xDefinition.kind} hideLabel />
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
                    layout={cartesianLayout({
                      xTitle: "x",
                      yTitle: functionMode === "cdf" ? "F(x)" : oneDefinition.kind === "continuous" ? "Density" : "Mass",
                      step: oneDefinition.kind === "discrete",
                      uirevision: `${one.id}-${rangeMode}`,
                    }) as any}
                    config={PLOT_CONFIG as any}
                    useResizeHandler
                    style={{ width: "100%", height: "100%" }}
                  />
                </Suspense>
              </PlotFrame>
              <div className="formula-strip">
                <div><span>Formula</span><code>{oneDefinition.formula}</code></div>
                <p>{oneDefinition.description}</p>
              </div>
              <ChartFooter left="Drag to zoom · Double-click to reset · Camera icon exports PNG" right={parameterSummary(oneDefinition, one.parameters)} />
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
                    layout={jointLayout(jointView, xDefinition, yDefinition, jointFunction) as any}
                    config={PLOT_CONFIG as any}
                    useResizeHandler
                    style={{ width: "100%", height: "100%" }}
                  />
                </Suspense>
              </PlotFrame>
              <div className="formula-strip joint-formula-strip">
                <div><span>Joint rule</span><code>{jointFunction === "cdf" ? "Fₓ,ᵧ(x,y) = Fₓ(x) · Fᵧ(y)" : "fₓ,ᵧ(x,y) = fₓ(x) · fᵧ(y)"}</code></div>
                <p>Both marginals are user-defined and independent. Surface height or colour represents the joint value.</p>
              </div>
              <ChartFooter left={jointView === "surface" ? "Drag to rotate · Scroll to zoom · Double-click to reset" : "Drag to zoom · Hover for joint values"} right={`${xDefinition.kind} pair`} />
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
                      layout={riskLayout(riskDefinition, riskResult, tailDirection, riskPlot.maxY) as any}
                      config={PLOT_CONFIG as any}
                      useResizeHandler
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <Plot
                      data={tailPlotData(riskDefinition, risk.parameters, regularTailSeries) as any}
                      layout={tailLayout(riskDefinition) as any}
                      config={PLOT_CONFIG as any}
                      useResizeHandler
                      style={{ width: "100%", height: "100%" }}
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
      </section>
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
  hideLabel = false,
}: {
  value: string;
  onChange: (value: string) => void;
  kind?: "continuous" | "discrete";
  hideLabel?: boolean;
}) {
  const candidates = kind ? distributions.filter((item) => item.kind === kind) : distributions;
  return (
    <label className={hideLabel ? "picker-wrap compact-picker" : "picker-wrap"}>
      {!hideLabel && <span className="field-label">Distribution <small>分布</small></span>}
      <select className="select-control" value={value} onChange={(event) => onChange(event.target.value)}>
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
              <label htmlFor={`${definition.id}-${parameter.key}`}>{parameter.label} <span>{parameter.symbol}</span></label>
              <input
                id={`${definition.id}-${parameter.key}`}
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
  return <div className="plot-wrap">{error ? <div className="plot-error"><strong>Check parameters</strong><span>{error}</span></div> : children}</div>;
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
    fillcolor: "rgba(85, 230, 210, 0.10)",
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
        marker: { color: sample.x.map((x) => inTail(x) ? "#ff8b72" : "#55e6d2"), opacity: 0.86 },
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
        line: { color: "#55e6d2", width: 2.6 },
        fill: "tozeroy",
        fillcolor: "rgba(85,230,210,.07)",
        hovertemplate: "x = %{x:.5g}<br>PDF = %{y:.6g}<extra></extra>",
      },
      {
        x: selectedX,
        y: selectedY,
        type: "scatter",
        mode: "lines",
        line: { color: "#ff8b72", width: 2 },
        fill: "tozeroy",
        fillcolor: "rgba(255,107,107,.28)",
        hovertemplate: "Tail x = %{x:.5g}<br>PDF = %{y:.6g}<extra></extra>",
      },
    ],
    maxY,
  };
}

function cartesianLayout({ xTitle, yTitle, step, uirevision }: { xTitle: string; yTitle: string; step?: boolean; uirevision: string }) {
  return {
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 62, r: 26, t: 22, b: 55 },
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.08, font: { size: 11, color: "#8094aa" }, bgcolor: "rgba(0,0,0,0)" },
    hovermode: "x unified",
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
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: view === "surface" ? { l: 16, r: 20, t: 18, b: 18 } : { l: 66, r: 78, t: 24, b: 60 },
    font: plotFont(),
    uirevision: `${x.id}-${y.id}-${view}`,
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
  return { ...common, xaxis: axisStyle(`X · ${x.name}`), yaxis: axisStyle(`Y · ${y.name}`) };
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
  const shapes: any[] = [{ type: "line", x0: result.valueAtRisk, x1: result.valueAtRisk, y0: 0, y1: 1, yref: "paper", line: { color: "#ffb76b", width: 2, dash: "dash" } }];
  const annotations: any[] = [{ x: result.valueAtRisk, y: markerY, text: "VaR", showarrow: true, arrowcolor: "#ffb76b", font: { color: "#ffcf96" }, bgcolor: "#152133", borderpad: 5 }];
  if (Number.isFinite(result.expectedShortfall)) {
    shapes.push({ type: "line", x0: result.expectedShortfall, x1: result.expectedShortfall, y0: 0, y1: 1, yref: "paper", line: { color: "#ff6f78", width: 2, dash: "dot" } });
    annotations.push({ x: result.expectedShortfall, y: markerY * 0.72, text: result.approximate ? "ES ≈" : "ES", showarrow: true, arrowcolor: "#ff6f78", font: { color: "#ff9ca3" }, bgcolor: "#152133", borderpad: 5 });
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
    line: { color: "#55e6d2", width: 3 },
    marker: { color: "#55e6d2", size: 5 },
    hovertemplate: "x = %{x:.6g}<br>S(x) = %{y:.4e}<extra></extra>",
  }];
  if (series.reference) {
    data.push({
      x: series.x,
      y: series.reference,
      type: "scatter",
      mode: "lines",
      name: `Reference slope ${formatCompact(definition.tail(parameters).exponent ?? Number.NaN)}`,
      line: { color: "#ffb76b", width: 2, dash: "dash" },
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
    title: { text: title, font: { color: "#74889e", size: 12 } },
    gridcolor: "rgba(143,167,194,.11)",
    zerolinecolor: "rgba(143,167,194,.22)",
    tickfont: { color: "#71859b", size: 11 },
    automargin: true,
  };
}

function sceneAxis(title: string) {
  return {
    title: { text: title, font: { color: "#8197ac", size: 11 } },
    color: "#7890a7",
    gridcolor: "rgba(143,167,194,.15)",
    zerolinecolor: "rgba(143,167,194,.25)",
    backgroundcolor: "rgba(6,17,29,.32)",
    showbackground: true,
  };
}

function plotFont() { return { color: "#9bb0c4", family: "Inter, ui-sans-serif, system-ui" }; }

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
