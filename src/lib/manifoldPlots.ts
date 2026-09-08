import type { Data, Layout } from "plotly.js";
import { add3, scale3, tangentVector, type ManifoldExample, type Vec2, type Vec3 } from "./manifolds";

export const manifoldColors = { surface: "#9badc1", plane: "#c2b09b", vector: "#a9c4b0", path: "#cfaaa4", point: "#f0eae0" };

function grid(n: number, at: (u: number, v: number) => Vec3) {
  const points = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => at(i / (n - 1), j / (n - 1))));
  return {
    x: points.map((row) => row.map((p) => p[0])),
    y: points.map((row) => row.map((p) => p[1])),
    z: points.map((row) => row.map((p) => p[2])),
  };
}

export function manifoldSurface(example: ManifoldExample) {
  const [u, v] = example.coordinates.map((c) => c.range);
  const mesh = grid(43, (s, t) => example.embed([u[0] + s * (u[1] - u[0]), v[0] + t * (v[1] - v[0])]));
  const bounds = [mesh.x, mesh.y, mesh.z].map((axis) => {
    const flat = axis.flat();
    return [Math.min(...flat), Math.max(...flat)] as Vec2;
  });
  const trace = {
    ...mesh, type: "surface", name: "M · 流形", opacity: 0.56, showscale: false,
    colorscale: [[0, "#384755"], [0.5, "#788d9c"], [1, "#b6c5c7"]],
    lighting: { ambient: 0.72, diffuse: 0.65, specular: 0.12, roughness: 0.8, fresnel: 0.1 },
    lightposition: { x: 100, y: 150, z: 200 },
    hovertemplate: `${example.axes[0]} = %{x:.3f}<br>${example.axes[1]} = %{y:.3f}<br>${example.axes[2]} = %{z:.3f}<extra>M</extra>`,
  } as Data;
  return { trace, bounds };
}

function line3(points: Vec3[], name: string, color: string, width = 5, dash = false): Data {
  return {
    type: "scatter3d", mode: "lines", name,
    x: points.map((p) => p[0]), y: points.map((p) => p[1]), z: points.map((p) => p[2]),
    line: { color, width, dash: dash ? "dash" : "solid" }, hoverinfo: "skip", showlegend: false,
  };
}

/** Wire arrowhead, constructed in display-normalized coordinates without WebGL cones. */
function arrow3(origin: Vec3, delta: Vec3, bounds: Vec2[], color: string): Data[] {
  const spans = bounds.map(([lo, hi]) => Math.max(hi - lo, 1e-6)) as Vec3;
  const d = delta.map((value, i) => value / spans[i]) as Vec3;
  const length = Math.hypot(...d);
  if (length < 1e-9) return [];
  const unit = scale3(d, 1 / length);
  const helper: Vec3 = Math.abs(unit[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0];
  const cross: Vec3 = [unit[1] * helper[2] - unit[2] * helper[1], unit[2] * helper[0] - unit[0] * helper[2], unit[0] * helper[1] - unit[1] * helper[0]];
  const side = scale3(cross, 1 / Math.hypot(...cross));
  const tip = add3(origin, delta);
  const wing = (sign: number) => add3(tip, add3(scale3(unit, -0.18 * length), scale3(side, sign * 0.075 * length)).map((value, i) => value * spans[i]) as Vec3);
  return [line3([origin, tip], "v · 切向量", color, 7), line3([wing(-1), tip, wing(1)], "v · 箭头", color, 6)];
}

export function manifoldFigure(
  example: ManifoldExample,
  surface: ReturnType<typeof manifoldSurface>,
  q: Vec2,
  vector: Vec2,
  step: number,
  showPlane: boolean,
  showPath: boolean,
) {
  const p = example.embed(q);
  const [eu, ev] = example.basis(q);
  const velocity = tangentVector(example, q, vector);
  const spans = surface.bounds.map(([lo, hi]) => Math.max(hi - lo, 1e-6));
  const normalizedLength = Math.hypot(...velocity.map((value, i) => value / spans[i]));
  const vectorScale = normalizedLength > 1e-9 ? Math.min(1, 0.26 / normalizedLength) : 1;
  // Plane and vector use the same parameter basis; the plane is a finite displayed patch.
  const patch = example.coordinates.map((c, i) => Math.max((c.range[1] - c.range[0]) * 0.095, Math.abs(vector[i] * vectorScale) * 1.18));
  const onPlane = (s: number, t: number) => add3(p, add3(scale3(eu, s), scale3(ev, t)));
  const data: Data[] = [surface.trace];
  if (showPlane) {
    const mesh = grid(2, (s, t) => onPlane((2 * s - 1) * patch[0], (2 * t - 1) * patch[1]));
    data.push({ ...mesh, type: "surface", name: "TₚM · 切平面", opacity: 0.3, colorscale: [[0, manifoldColors.plane], [1, manifoldColors.plane]], showscale: false, hoverinfo: "skip" } as Data);
    data.push(line3([onPlane(-patch[0], -patch[1]), onPlane(patch[0], -patch[1]), onPlane(patch[0], patch[1]), onPlane(-patch[0], patch[1]), onPlane(-patch[0], -patch[1])], "切平面边缘", manifoldColors.plane, 3));
    for (const s of [-0.5, 0, 0.5]) {
      data.push(line3([onPlane(s * patch[0], -patch[1]), onPlane(s * patch[0], patch[1])], "切平面网格", "#a99884", 1));
      data.push(line3([onPlane(-patch[0], s * patch[1]), onPlane(patch[0], s * patch[1])], "切平面网格", "#a99884", 1));
    }
  }
  if (showPath && step > 0 && normalizedLength > 1e-9) {
    const path = Array.from({ length: 30 }, (_, i) => {
      const t = step * i / 29;
      return example.embed([q[0] + t * vector[0], q[1] + t * vector[1]]);
    });
    data.push(line3(path, "曲面上的路径", manifoldColors.path, 6));
    data.push(line3([p, add3(p, scale3(velocity, step))], "一阶近似路径", manifoldColors.plane, 4, true));
    const end = path[path.length - 1];
    data.push({ type: "scatter3d", mode: "markers", x: [end[0]], y: [end[1]], z: [end[2]], marker: { color: manifoldColors.path, size: 4 }, name: "路径终点", hoverinfo: "skip", showlegend: false });
  }
  const arrow = scale3(velocity, vectorScale);
  data.push(...arrow3(p, arrow, surface.bounds, manifoldColors.vector));
  const tip = add3(p, arrow);
  const moving = normalizedLength > 1e-9;
  const markers = moving ? [p, tip] : [p];
  data.push({ type: "scatter3d", mode: "markers+text", x: markers.map((point) => point[0]), y: markers.map((point) => point[1]), z: markers.map((point) => point[2]),
    marker: { color: moving ? [manifoldColors.point, manifoldColors.vector] : manifoldColors.point, size: moving ? [5, 1] : 5 },
    text: moving ? ["p", "v"] : ["p · v = 0"], textposition: "top center", textfont: { color: "#f0eae0", size: 15 },
    name: "当前点与切向量", hoverinfo: "skip", showlegend: false,
  });
  return { data, vectorScale };
}

export function manifoldLayout(example: ManifoldExample, bounds: Vec2[], compact = false): Partial<Layout> {
  const cameraScale = compact ? 1.3 : 1;
  const axis = (index: number) => ({
    title: { text: example.axes[index], font: { size: 11, color: "#c1c5cb" } },
    range: [bounds[index][0] - (bounds[index][1] - bounds[index][0]) * 0.15, bounds[index][1] + (bounds[index][1] - bounds[index][0]) * 0.15] as Vec2,
    autorange: false, showbackground: false, gridcolor: "#373c43", linecolor: "#555c66", zeroline: false,
    tickfont: { size: 10, color: "#a4a7ae" }, nticks: 5, showspikes: false,
  });
  return {
    autosize: true, paper_bgcolor: "#1b1d21", plot_bgcolor: "#1b1d21", font: { family: "-apple-system, BlinkMacSystemFont, sans-serif", color: "#e4e3df" },
    margin: { t: 35, r: 10, b: 10, l: 10 }, showlegend: false,
    uirevision: `manifold-${example.id}`, hovermode: "closest",
    scene: {
      xaxis: axis(0), yaxis: axis(1), zaxis: axis(2),
      aspectmode: ["sphere", "simplex", "pendulum"].includes(example.id) ? "data" : "cube",
      camera: { eye: {
        x: (example.id === "option" ? -1.25 : 1.15) * cameraScale,
        y: (["normal", "option", "portfolio"].includes(example.id) ? -1.4 : 1.15) * cameraScale,
        z: 0.95 * cameraScale,
      }, up: { x: 0, y: 0, z: 1 }, center: { x: 0, y: 0, z: 0 } },
      dragmode: "orbit", uirevision: `manifold-${example.id}`,
    },
  };
}
