import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { localComparison, manifoldCategories, manifoldExamples, simplexWeights, type ManifoldExample, type Vec2 } from "../lib/manifolds";
import { manifoldColors, manifoldFigure, manifoldLayout, manifoldSurface } from "../lib/manifoldPlots";
import "./manifold.css";

const Plot = lazy(() => import("./InteractivePlot"));
const STORAGE_KEY = "mathview-manifold-v1";
type Settings = { q: Vec2; vector: Vec2; step: number };
type Workspace = { selected: string; settings: Record<string, Settings> };
const defaults = (example: ManifoldExample): Settings => ({ q: [...example.initial], vector: [...example.initialVector], step: 0.3 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const number = (value: number) => Math.abs(value) < 0.000005 ? "0" : Math.abs(value) >= 1000 ? value.toFixed(1) : Number(value.toFixed(4)).toString();
const signed = (value: number) => `${value > 0.000005 ? "+" : ""}${number(value)}`;

function readWorkspace(): Workspace {
  const fallback: Workspace = { selected: "normal", settings: {} };
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || !manifoldExamples.some((example) => example.id === stored.selected)) return fallback;
    const settings: Record<string, Settings> = {};
    for (const example of manifoldExamples) {
      const saved = stored.settings?.[example.id];
      if (!saved || !Array.isArray(saved.q) || !Array.isArray(saved.vector) || saved.q.length !== 2 || saved.vector.length !== 2) continue;
      if (![...saved.q, ...saved.vector, saved.step].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
      settings[example.id] = {
        q: saved.q.map((value: number, i: number) => clamp(value, ...example.coordinates[i].range)) as Vec2,
        vector: saved.vector.map((value: number, i: number) => clamp(value, -example.coordinates[i].vectorLimit, example.coordinates[i].vectorLimit)) as Vec2,
        step: clamp(saved.step, 0.01, 0.8),
      };
    }
    return { selected: stored.selected, settings };
  } catch { return fallback; }
}

export default function ManifoldPage() {
  const [workspace, setWorkspace] = useState(readWorkspace);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [showPlane, setShowPlane] = useState(true);
  const [showPath, setShowPath] = useState(true);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const latest = useRef(workspace);
  const example = manifoldExamples.find((item) => item.id === workspace.selected)!;
  const settings = workspace.settings[example.id] ?? defaults(example);
  const { q, vector, step } = settings;
  const category = manifoldCategories.find((item) => item.id === example.category)!;
  const surface = useMemo(() => manifoldSurface(example), [example]);
  const layout = useMemo(() => manifoldLayout(example, surface.bounds, compact), [example, surface, compact]);
  const comparison = localComparison(example, q, vector, step);
  const figure = useMemo(() => manifoldFigure(example, surface, q, vector, comparison.step, showPlane, showPath), [example, surface, q, vector, comparison.step, showPlane, showPath]);
  const alpha = example.differential(q);
  const physical = example.category === "physics";
  const stepSymbol = physical ? "Δt" : "ε";
  const coordinateSymbols = example.coordinates.map((coordinate) => coordinate.symbol);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const resize = () => setCompact(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    latest.current = workspace;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); } catch { /* Optional browser storage. */ }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [workspace]);
  useEffect(() => {
    const flush = () => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)); } catch { /* The page also works without storage. */ } };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const update = (change: Partial<Settings>) => setWorkspace((current) => ({
    ...current, settings: { ...current.settings, [example.id]: { ...(current.settings[example.id] ?? defaults(example)), ...change } },
  }));
  const select = (id: string) => setWorkspace((current) => ({ ...current, selected: id }));
  const setVectorComponent = (index: number, value: number) => {
    const next = [...vector] as Vec2;
    next[index] = value;
    update({ vector: next });
  };

  return (
    <section className="workspace manifold-workspace" data-controls-open={controlsOpen} lang="zh-CN">
      <button className="mobile-controls-toggle" type="button" aria-expanded={controlsOpen} aria-controls="manifold-controls" onClick={() => setControlsOpen((open) => !open)}>
        <span>{example.name}<small>示例与方向</small></span><span>{controlsOpen ? "收起 −" : "展开 ＋"}</span>
      </button>
      <aside id="manifold-controls" className="control-panel" aria-label="Manifold controls">
        <div className="panel-heading"><span className="eyebrow">Explore geometry</span><span className="formula-chip">M · TₚM · T*ₚM</span></div>
        <div className="manifold-categories" aria-label="示例领域">
          {manifoldCategories.map((item) => <button type="button" key={item.id} aria-pressed={example.category === item.id} className={example.category === item.id ? "is-active" : ""} onClick={() => select(manifoldExamples.find((candidate) => candidate.category === item.id)!.id)}>{item.label}<small>{item.english}</small></button>)}
        </div>
        <label className="picker-wrap">
          <span className="field-label">Example <small>示例</small></span>
          <select className="select-control" aria-label="流形示例" value={example.id} onChange={(event) => select(event.target.value)}>
            {manifoldExamples.filter((item) => item.category === example.category).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <p className="manifold-description">{example.description}</p>
        <ContextSketch example={example} q={q} />
        <div className="section-rule" />
        <div className="control-title">Base point <small>当前位置 p</small></div>
        {example.coordinates.map((coordinate, i) => <Slider key={`${example.id}-q-${i}`} label={coordinate.label} symbol={coordinate.symbol} value={q[i]} min={coordinate.range[0]} max={coordinate.range[1]} step={coordinate.step} onChange={(value) => { const next = [...q] as Vec2; next[i] = value; update({ q: next }); }} />)}
        <div className="section-rule" />
        <div className="control-title">Tangent vector <small>{physical ? "瞬时角速度 v" : "移动方向 v"}</small></div>
        {example.coordinates.map((coordinate, i) => <Slider key={`${example.id}-v-${i}`} label={`${coordinate.symbol} 方向分量${physical ? " / rad·s⁻¹" : ""}`} symbol={i === 0 ? "v¹" : "v²"} value={vector[i]} min={-coordinate.vectorLimit} max={coordinate.vectorLimit} step={coordinate.vectorStep} onChange={(value) => setVectorComponent(i, value)} accent />)}
        <p className="parameter-help">也可拖动右侧切空间中的箭头。负值表示反向，两个分量均为 0 时表示静止。</p>
        <div className="section-rule" />
        <Slider label={physical ? "比较时间 / s" : "局部比较的步长"} symbol={stepSymbol} value={step} min={0.01} max={0.8} step={0.01} onChange={(value) => update({ step: value })} />
        <div className="manifold-layer-controls">
          <label><input type="checkbox" checked={showPlane} onChange={(event) => setShowPlane(event.target.checked)} />显示切平面</label>
          <label><input type="checkbox" checked={showPath} onChange={(event) => setShowPath(event.target.checked)} />显示路径与一阶近似</label>
        </div>
        <button type="button" className="secondary-button manifold-reset" onClick={() => { update(defaults(example)); setShowPlane(true); setShowPath(true); }}>重置当前示例</button>
      </aside>

      <section className="manifold-main" aria-label="Manifold visualization">
        <header className="chart-toolbar manifold-toolbar">
          <div><span className="eyebrow">{category.english} / {example.englishName}</span><h1>Manifold explorer <span>流形</span></h1></div>
          <div className="manifold-dimension">2 个自由度<span>当前位置 → 运动方向 → 数值变化</span></div>
        </header>
        <div className="manifold-stage">
          <section className="manifold-scene" aria-label="流形与切平面">
            <div className="space-heading"><span className="space-symbol">M</span><div><h2>流形与切平面</h2><p>拖动旋转 · 滚轮缩放 · 双击复位</p></div></div>
            <div className="plot-wrap manifold-plot">
              <Suspense fallback={<div className="plot-fallback" role="status"><span /><p>正在绘制流形…</p></div>}><Plot data={figure.data} layout={layout} /></Suspense>
            </div>
            <div className="manifold-legend">
              <span><i style={{ background: manifoldColors.point }} />p 当前点</span>
              <span><i style={{ background: manifoldColors.plane }} />TₚM 切平面</span>
              <span><i style={{ background: manifoldColors.vector }} />v 切向量</span>
              <span><i style={{ background: manifoldColors.path }} />曲面路径</span>
            </div>
            {compact && <p className="manifold-axis-key">坐标轴 X：{example.axes[0]} · Y：{example.axes[1]} · Z：{example.axes[2]}</p>}
            <p className="manifold-scale-note">切平面仅显示局部窗口；三维箭头显示为 {number(figure.vectorScale)} × v。{["normal", "portfolio", "option"].includes(example.id) ? "三个坐标轴分别缩放，视觉角度不表示内在度量。" : ""}</p>
          </section>
          <div className="manifold-spaces">
            <section className="space-panel tangent-space" aria-label="Tangent space 切空间">
              <div className="space-heading"><span className="space-symbol">TₚM</span><div><h2>Tangent space <span>切空间</span></h2><p>在 p 处，可以怎样移动？</p></div></div>
              <SpaceDiagram kind="tangent" components={vector} symbols={coordinateSymbols} limits={example.coordinates.map((c) => c.vectorLimit) as Vec2} onChange={(next) => update({ vector: next })} />
              <code className="space-components">v = {number(vector[0])} ∂{coordinateSymbols[0]} + ({number(vector[1])}) ∂{coordinateSymbols[1]}</code>
            </section>
            <section className="space-panel cotangent-space" aria-label="Cotangent space 余切空间">
              <div className="space-heading"><span className="space-symbol">T*ₚM</span><div><h2>Cotangent space <span>余切空间</span></h2><p>一个方向，会带来多少变化？</p></div></div>
              <SpaceDiagram kind="cotangent" components={alpha} symbols={coordinateSymbols} />
              <code className="space-components">α = df = {number(alpha[0])} d{coordinateSymbols[0]} + ({number(alpha[1])}) d{coordinateSymbols[1]}</code>
              <p className="dual-note">箭头是 Covector（余向量）在对偶基中的坐标表示；它作用于切向量。两图的箭头长度不可直接比较。</p>
            </section>
          </div>
        </div>

        <section className="manifold-pairing" aria-label="余向量与切向量的配对结果">
          <div className="pairing-primary"><span>Dual pairing <small>对偶配对 · {physical ? "势能变化率" : "瞬时变化率"}</small></span><div><strong data-testid="pairing-rate">{signed(comparison.rate)}</strong><span>{physical ? "W" : `${example.unit} / 单位步长`}</span></div><code>df(v) = α₁v¹ + α₂v²</code></div>
          <div className="pairing-context"><strong>{example.observable}</strong><p>{example.interpretation}</p><span>当前 f(p) = {number(example.scalar(q))} {example.unit}</span></div>
          <div className="pairing-comparison">
            <div><span>一阶近似 {stepSymbol} · df(v)</span><strong data-testid="predicted-change">{signed(comparison.predicted)}</strong></div>
            <div><span>沿曲面计算的实际 Δf</span><strong data-testid="actual-change">{signed(comparison.actual)}</strong></div>
            <div><span>差值 · 实际 − 近似</span><strong data-testid="approximation-error">{signed(comparison.error)}</strong></div>
            <p>有效{physical ? "时间" : "步长"} {stepSymbol} = {number(comparison.step)}{physical ? " s" : ""} · 变化量单位：{example.unit || "同 f"}</p>
          </div>
        </section>
        {comparison.step < step - 1e-8 && <p className="manifold-boundary" role="status">所选方向到达当前坐标窗口边界，比较{physical ? "时间" : "步长"}已缩至 {number(comparison.step)}{physical ? " s" : ""}。可反转方向，或把当前位置移回内部；切空间中的方向仍然有效。</p>}
        <p className="manifold-learning-note">试着减小{physical ? "比较时间" : "步长"}，观察实际变化怎样接近一阶近似。切空间中的坐标基为 ∂{coordinateSymbols[0]}、∂{coordinateSymbols[1]}；余切空间使用对应的对偶基 d{coordinateSymbols[0]}、d{coordinateSymbols[1]}，满足 dqⁱ(∂qʲ) = δⁱⱼ。</p>
        <details className="manifold-details"><summary>公式、模型约定与参考</summary>
          <div className="manifold-formulas"><code>{example.formula}</code><code>{example.observableFormula}</code><code>TₚM = span(∂₁Φ, ∂₂Φ); v = v¹∂₁Φ + v²∂₂Φ; α(v) = α₁v¹ + α₂v²</code></div>
          <p>{example.convention}</p><p>每个例子展示一个二维流形。余切空间 T*ₚM 是 TₚM 的 Dual space（对偶空间），单独以坐标图表示；选择度量之后才可将余向量与梯度向量对应。图中的 α = df，不是曲面的法向量。</p>
          <a href={example.source.url} target="_blank" rel="noreferrer">{example.source.label} ↗</a><a href="https://sites.math.washington.edu/~lee/Books/ISM/" target="_blank" rel="noreferrer">Tangent & cotangent spaces · John M. Lee ↗</a>
        </details>
      </section>
    </section>
  );
}

function Slider({ label, symbol, value, min, max, step, onChange, accent = false }: { label: string; symbol: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; accent?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(clamp(Number(draft), min, max));
    setDraft(null);
  };
  return <div className={`parameter-block manifold-slider ${accent ? "vector-slider" : ""}`}>
    <div className="parameter-row"><label htmlFor={id}>{label}<span>{symbol}</span></label><input id={id} className="number-input" type="number" inputMode="decimal" min={min} max={max} step={step} value={draft ?? number(value)} onFocus={() => setDraft(number(value))} onChange={(event) => {
      setDraft(event.target.value);
      if (event.target.value.trim() !== "" && Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber >= min && event.target.valueAsNumber <= max) onChange(event.target.valueAsNumber);
    }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></div>
    <input className="range-input" type="range" aria-label={`${label}滑块`} min={min} max={max} step={step} value={value} onChange={(event) => { setDraft(null); onChange(Number(event.target.value)); }} />
  </div>;
}

function SpaceDiagram({ kind, components, symbols, limits, onChange }: { kind: "tangent" | "cotangent"; components: Vec2; symbols: string[]; limits?: Vec2; onChange?: (value: Vec2) => void }) {
  const id = useId().replace(/:/g, "");
  const dragging = useRef(false);
  const tangent = kind === "tangent";
  const color = tangent ? manifoldColors.vector : manifoldColors.path;
  const extent = tangent ? Math.max(...limits!) * 1.25 : Math.max(Math.abs(components[0]), Math.abs(components[1]), 0.1) * 1.35;
  const scale = 60 / extent;
  const center: Vec2 = [145, 86];
  const x = center[0] + components[0] * scale;
  const y = center[1] - components[1] * scale;
  const zero = Math.hypot(...components) < 1e-8;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!onChange || !limits) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const next: Vec2 = [clamp((point.x - center[0]) / scale, -limits[0], limits[0]), clamp((center[1] - point.y) / scale, -limits[1], limits[1])];
    onChange(next.map((value) => Math.round(value * 1000) / 1000) as Vec2);
  };
  return <svg className={`space-diagram ${tangent ? "is-editable" : ""}`} viewBox="0 0 290 168" role="img" aria-label={`${tangent ? "切向量 v" : "余向量 α"}坐标图：(${number(components[0])}, ${number(components[1])})${tangent ? "，可拖动；也可使用侧栏数值输入" : "，基为对应坐标的微分"}`} onPointerDown={tangent ? (event) => { if (event.button !== 0) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); move(event); } : undefined} onPointerMove={tangent ? (event) => { if (dragging.current) move(event); } : undefined} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }}>
    <defs><marker id={`arrow-${id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6" fill="none" stroke={color} strokeWidth="1.3" /></marker></defs>
    {[-2, -1, 1, 2].map((tick) => <g key={tick} className="space-grid"><line x1={center[0] + tick * 30} y1="22" x2={center[0] + tick * 30} y2="148" /><line x1="52" y1={center[1] + tick * 30} x2="238" y2={center[1] + tick * 30} /></g>)}
    <g className="space-axis"><line x1="43" y1={center[1]} x2="247" y2={center[1]} /><line x1={center[0]} y1="16" x2={center[0]} y2="151" /></g>
    <g className="space-axis-labels"><text x="250" y="90">{tangent ? "∂" : "d"}{symbols[0]}</text><text x="152" y="17">{tangent ? "∂" : "d"}{symbols[1]}</text><text x="132" y="102">0</text><text x="210" y="102">{number(extent)}</text><text x="152" y="32">{number(extent)}</text></g>
    {!zero && <><path d={`M ${center[0]} ${center[1]} L ${x} ${y}`} fill="none" stroke={color} strokeWidth="2.6" markerEnd={`url(#arrow-${id})`} /><path d={`M ${x} ${center[1]} L ${x} ${y} L ${center[0]} ${y}`} fill="none" stroke={color} strokeOpacity="0.35" strokeDasharray="3 4" /></>}
    <circle cx={zero ? center[0] : x} cy={zero ? center[1] : y} r={tangent ? 8 : 3} fill={color} fillOpacity={tangent ? 0.22 : 0.7} stroke={color} />
    <text x={clamp(x + 11, 22, 255)} y={clamp(y - 11, 15, 148)} className="space-vector-label" fill={color}>{tangent ? "v" : "α"}{zero ? " = 0" : ""}</text>
    {tangent && <text x="12" y="159" className="space-drag-hint">拖动箭头调整方向</text>}
  </svg>;
}

function ContextSketch({ example, q }: { example: ManifoldExample; q: Vec2 }) {
  if (example.id === "simplex" || example.id === "portfolio") {
    const w = simplexWeights(q);
    return <div className="manifold-weights"><div aria-hidden="true">{w.map((value, i) => <span key={i} style={{ width: `${value * 100}%`, background: ["#9badc1", "#b3a18e", "#92a99b"][i] }} />)}</div><p>{w.map((value, i) => <span key={i}>{example.id === "simplex" ? "p" : "w"}{["₁", "₂", "₃"][i]} {number(value * 100)}%</span>)}</p></div>;
  }
  if (example.id === "pendulum") {
    const origin: Vec2 = [115, 34];
    const first: Vec2 = [origin[0] + 36 * Math.sin(q[0]), origin[1] + 36 * Math.cos(q[0])];
    const second: Vec2 = [first[0] + 36 * Math.sin(q[1]), first[1] + 36 * Math.cos(q[1])];
    return <figure className="pendulum-sketch"><svg viewBox="0 -40 230 164" role="img" aria-label={`双摆实际摆形：第一杆角度 ${number(q[0])}，第二杆角度 ${number(q[1])} 弧度`}><path d="M94 29H136 M115 34V108" stroke="#5d646e" strokeDasharray="3 4" /><path d={`M${origin} L${first} L${second}`} fill="none" stroke="#b3a18e" strokeWidth="3" /><circle cx={origin[0]} cy={origin[1]} r="3" fill="#e4e3df" /><circle cx={first[0]} cy={first[1]} r="6" fill="#9badc1" /><circle cx={second[0]} cy={second[1]} r="6" fill="#a9c4b0" /><text x={first[0] + 10} y={first[1]} fill="#a4a7ae" fontSize="11">m₁</text><text x={second[0] + 10} y={second[1]} fill="#a4a7ae" fontSize="11">m₂</text></svg><figcaption>当前角度对应的实际摆形</figcaption></figure>;
  }
  return null;
}
