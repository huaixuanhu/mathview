import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import Plotly from "plotly.js/dist/plotly";
import type { Config, Data, Layout } from "plotly.js";
import { createRenderQueue } from "../lib/renderQueue";
import { createPlotCrosshair } from "../lib/plotCrosshair";

interface Figure {
  data: Data[];
  layout: Partial<Layout>;
}

type ResetAxis = "x" | "y" | "both";

const CONFIG: Partial<Config> = {
  displayModeBar: false,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: false,
  showAxisRangeEntryBoxes: false,
  responsive: false, // The container observer also covers changes without a window resize.
};

/** Keep Plotly's mutable figure separate from React state and render only the latest input. */
const InteractivePlot = memo(function InteractivePlot({ data, layout }: Figure) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef<Figure>({ data, layout });
  const controls = useRef<{ update: (figure: Figure) => void; reset: (axis: ResetAxis) => void; export: () => void } | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  useEffect(() => {
    const container = host.current!;
    // Each effect owns its node, including React StrictMode's setup/cleanup cycle.
    const graph = document.createElement("div");
    graph.className = "plot-canvas";
    container.prepend(graph);
    const crosshair = createPlotCrosshair(graph);
    let disposed = false;
    let initialized = false;
    let resize = false;
    let reset: ResetAxis | null = null;
    let exportImage = false;
    let rendered: Figure | null = null;
    let lastPointer: { clientX: number; clientY: number; target: EventTarget | null } | null = null;

    const queue = createRenderQueue<Figure>(async (figure) => {
      if (rendered !== figure) {
        if (initialized) Plotly.Fx.unhover(graph);
        // Plotly mutates axes, traces and visibility. Never hand it a memoized input object.
        const plot = await Plotly.react(graph, structuredClone(figure.data), structuredClone(figure.layout), CONFIG);
        rendered = figure;
        if (!initialized) {
          plot.on("plotly_doubleclick", onPlotlyDoubleClick);
          plot.on("plotly_afterplot", crosshair.refresh);
        }
        initialized = true;
        crosshair.refresh();
        if (!disposed) setError(false);
      }
      if (disposed || figure !== latest.current) return;
      if (resize) {
        resize = false;
        // The observer already coalesces sizes; avoid Plots.resize's delayed timer,
        // which can otherwise replot in the middle of the user's first drag.
        await Plotly.relayout(graph, { autosize: true });
      }
      if (reset) {
        const axes = reset === "both" ? ["x", "y"] as const : [reset];
        reset = null;
        if (figure.layout.scene) {
          await Plotly.relayout(graph, { "scene.camera": structuredClone(figure.layout.scene.camera) } as Partial<Layout>);
        } else {
          const update: Record<string, unknown> = {};
          for (const axis of axes) {
            const name = axis === "x" ? "xaxis" : "yaxis";
            const defaults = figure.layout[name];
            if (defaults?.range && defaults.autorange === false) {
              update[`${name}.range`] = [...defaults.range];
              update[`${name}.autorange`] = false;
            } else {
              update[`${name}.autorange`] = true;
            }
          }
          await Plotly.relayout(graph, update as Partial<Layout>);
        }
      }
      if (exportImage) {
        exportImage = false;
        try {
          const options = { format: "png" as const, filename: "mathview-chart", scale: 2, width: graph.clientWidth, height: graph.clientHeight };
          await Plotly.downloadImage(graph, options);
        } catch {
          if (!disposed) setExportError(true);
        } finally {
          if (!disposed) setExporting(false);
        }
      }
      if (!disposed) setReady(true);
    }, () => { if (!disposed) setError(true); });

    const requestReset = (axis: ResetAxis) => {
      reset = reset && reset !== axis ? "both" : axis;
      queue.request(latest.current);
    };
    const onDoubleClick = (event: { clientX: number; clientY: number; target: EventTarget | null }) => {
      if (!initialized || !(event.target instanceof Element) || event.target.closest(".legend, .annotation, .plot-actions")) return;
      if (latest.current.layout.scene) { requestReset("both"); return; }
      const area = graph.querySelector(".nsewdrag")?.getBoundingClientRect();
      if (!area) return;
      const inX = event.clientX >= area.left && event.clientX <= area.right;
      const inY = event.clientY >= area.top && event.clientY <= area.bottom;
      if (inX && inY) requestReset("both");
      else if (inX && event.clientY > area.bottom) requestReset("x");
      else if (inY && event.clientX < area.left) requestReset("y");
    };
    // Plotly's main drag surface consumes native double clicks; its event has no coordinates.
    const rememberPointer = (event: MouseEvent) => { lastPointer = { clientX: event.clientX, clientY: event.clientY, target: event.target }; };
    const rememberTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) lastPointer = { clientX: touch.clientX, clientY: touch.clientY, target: event.target };
    };
    const onPlotlyDoubleClick = () => { if (lastPointer) onDoubleClick(lastPointer); };
    graph.addEventListener("mousedown", rememberPointer, true);
    graph.addEventListener("touchstart", rememberTouch, { capture: true, passive: true });
    graph.addEventListener("dblclick", onDoubleClick);
    const bounds = container.getBoundingClientRect();
    let width = bounds.width;
    let height = bounds.height;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect;
      if (Math.abs(next.width - width) < 0.5 && Math.abs(next.height - height) < 0.5) return;
      width = next.width;
      height = next.height;
      if (!width || !height) return;
      resize = true;
      queue.request(latest.current);
    });
    observer.observe(container);
    controls.current = {
      update: (figure) => queue.request(figure),
      reset: requestReset,
      export: () => { exportImage = true; queue.request(latest.current); },
    };
    queue.request(latest.current);
    return () => {
      disposed = true;
      crosshair.dispose();
      observer.disconnect();
      graph.removeEventListener("mousedown", rememberPointer, true);
      graph.removeEventListener("touchstart", rememberTouch, true);
      graph.removeEventListener("dblclick", onDoubleClick);
      controls.current = null;
      graph.remove();
      void queue.dispose().then(() => Plotly.purge(graph));
    };
  }, []);

  useLayoutEffect(() => {
    latest.current = { data, layout };
    controls.current?.update(latest.current);
  }, [data, layout]);

  return (
    <div className="interactive-plot" ref={host}>
      <div className="plot-actions">
        <button type="button" disabled={!ready || error} onClick={() => controls.current?.reset("both")} title="Restore default view · 恢复默认视图">Reset view</button>
        <button type="button" disabled={!ready || error || exporting} onClick={() => { setExportError(false); setExporting(true); controls.current?.export(); }} title="Download chart as PNG">{exporting ? "Saving…" : "PNG ↓"}</button>
      </div>
      {exportError && <div className="plot-export-error" role="alert">PNG export failed. Please try again.</div>}
      {error && <div className="plot-error" role="alert"><strong>Chart could not update</strong><span>Adjust a parameter or reload to try again.</span></div>}
    </div>
  );
});

export default InteractivePlot;
