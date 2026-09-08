import jStat from "jstat";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type ManifoldCategory = "statistics" | "finance" | "physics";

interface Coordinate {
  symbol: string;
  label: string;
  range: Vec2;
  step: number;
  vectorLimit: number;
  vectorStep: number;
  periodic?: boolean;
}

export interface ManifoldExample {
  id: string;
  category: ManifoldCategory;
  name: string;
  englishName: string;
  description: string;
  coordinates: [Coordinate, Coordinate];
  initial: Vec2;
  initialVector: Vec2;
  axes: [string, string, string];
  formula: string;
  observable: string;
  observableFormula: string;
  unit: string;
  interpretation: string;
  convention: string;
  source: { label: string; url: string };
  embed: (q: Vec2) => Vec3;
  basis: (q: Vec2) => [Vec3, Vec3];
  scalar: (q: Vec2) => number;
  differential: (q: Vec2) => Vec2;
}

export const manifoldCategories: { id: ManifoldCategory; label: string; english: string }[] = [
  { id: "statistics", label: "统计学", english: "Statistics" },
  { id: "finance", label: "金融", english: "Finance" },
  { id: "physics", label: "物理", english: "Physics" },
];

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, scale: number): Vec3 => [a[0] * scale, a[1] * scale, a[2] * scale];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const pair = (alpha: Vec2, vector: Vec2) => alpha[0] * vector[0] + alpha[1] * vector[1];

/** Interior simplex chart: the second coordinate divides the remaining probability. */
export function simplexWeights([u, v]: Vec2): Vec3 {
  return [u, (1 - u) * v, (1 - u) * (1 - v)];
}

export function simplexBasis([u, v]: Vec2): [Vec3, Vec3] {
  return [[1, -v, v - 1], [0, 1 - u, u - 1]];
}

// Synthetic annual covariance, with returns measured in percentage points.
// Volatilities: 12%, 20%, 28%; correlations: .20, .10, .25.
export const portfolioCovariance: [Vec3, Vec3, Vec3] = [[144, 48, 33.6], [48, 400, 140], [33.6, 140, 784]];
const covarianceTimes = (w: Vec3): Vec3 => portfolioCovariance.map((row) => dot3(row, w)) as Vec3;
export function portfolioVariance(q: Vec2) {
  const w = simplexWeights(q);
  return dot3(w, covarianceTimes(w));
}
function portfolioDifferential(q: Vec2): Vec2 {
  const sigmaW = covarianceTimes(simplexWeights(q));
  const [du, dv] = simplexBasis(q);
  return [2 * dot3(du, sigmaW), 2 * dot3(dv, sigmaW)];
}

/** European call with K=100, T=1 year, r=.03, no dividends; u=S/K. */
export function callPrice([m, sigma]: Vec2) {
  const d1 = (Math.log(m) + 0.03 + sigma * sigma / 2) / sigma;
  const d2 = d1 - sigma;
  return 100 * (m * jStat.normal.cdf(d1, 0, 1) - Math.exp(-0.03) * jStat.normal.cdf(d2, 0, 1));
}
export function callDifferential([m, sigma]: Vec2): Vec2 {
  const d1 = (Math.log(m) + 0.03 + sigma * sigma / 2) / sigma;
  // dC/dm = K * Delta. Vega is per unit decimal volatility, not per percentage point.
  return [100 * jStat.normal.cdf(d1, 0, 1), 100 * m * jStat.normal.pdf(d1, 0, 1)];
}

const weightCoordinates: [Coordinate, Coordinate] = [
  { symbol: "u", label: "第一项的占比", range: [0.06, 0.9], step: 0.01, vectorLimit: 0.4, vectorStep: 0.01 },
  { symbol: "v", label: "第二项占剩余部分的比例", range: [0.06, 0.94], step: 0.01, vectorLimit: 0.4, vectorStep: 0.01 },
];
const angle = (symbol: string, label: string): Coordinate => ({
  symbol, label, range: [-Math.PI, Math.PI], step: 0.01, vectorLimit: 1.5, vectorStep: 0.05, periodic: true,
});

export const manifoldExamples: ManifoldExample[] = [
  {
    id: "normal", category: "statistics", name: "正态分布族", englishName: "Normal family",
    description: "每个点是一组均值与标准差，也就对应一条正态分布。把二阶原点矩作为高度，观察分布参数变化的局部方向。",
    coordinates: [
      { symbol: "μ", label: "均值", range: [-1.5, 1.5], step: 0.05, vectorLimit: 1, vectorStep: 0.05 },
      { symbol: "σ", label: "标准差", range: [0.3, 1.6], step: 0.02, vectorLimit: 0.6, vectorStep: 0.02 },
    ],
    initial: [0.4, 0.8], initialVector: [0.5, 0.25], axes: ["μ", "σ", "E[X²]"],
    formula: "Φ(μ, σ) = (μ, σ, μ² + σ²)", observable: "二阶原点矩", observableFormula: "f = E[X²] = μ² + σ²", unit: "",
    interpretation: "α = df 衡量均值、标准差沿所选方向变化时，E[X²] 的瞬时变化率。",
    convention: "σ > 0。曲面是分布族的矩嵌入；画面中的距离与曲率不代表 Fisher–Rao metric（费舍尔–拉奥度量）。",
    source: { label: "Normal distribution · NIST", url: "https://www.itl.nist.gov/div898/handbook/eda/section3/eda3661.htm" },
    embed: ([u, v]) => [u, v, u * u + v * v],
    basis: ([u, v]) => [[1, 0, 2 * u], [0, 1, 2 * v]],
    scalar: ([u, v]) => u * u + v * v,
    differential: ([u, v]) => [2 * u, 2 * v],
  },
  {
    id: "simplex", category: "statistics", name: "三分类概率空间", englishName: "Probability simplex",
    description: "三个类别的概率之和为 1，只有两个自由度。用概率的平方根把它们映射到球面，观察信息熵如何随概率分配变化。",
    coordinates: weightCoordinates, initial: [0.3, 0.55], initialVector: [0.2, -0.15], axes: ["2√p₁", "2√p₂", "2√p₃"],
    formula: "p = (u, (1−u)v, (1−u)(1−v)); Φ = 2√p", observable: "Entropy（信息熵）", observableFormula: "f = H(p) = −Σ pᵢ ln pᵢ", unit: "nat",
    interpretation: "α = dH 衡量沿所选概率调整方向，信息熵增加或减少得有多快。",
    convention: "仅展示 pᵢ > 0 的内部区域。Φ = 2√p 落在半径 2 的正球面，保留 Fisher–Rao metric（费舍尔–拉奥度量）；坐标基向量未单位化。",
    source: { label: "Fisher geometry · Davis et al.", url: "https://arxiv.org/html/2405.14664v4#S3" },
    embed: (q) => simplexWeights(q).map((p) => 2 * Math.sqrt(p)) as Vec3,
    basis: (q) => {
      const p = simplexWeights(q);
      return simplexBasis(q).map((dp) => dp.map((value, i) => value / Math.sqrt(p[i])) as Vec3) as [Vec3, Vec3];
    },
    scalar: (q) => -simplexWeights(q).reduce((sum, p) => sum + p * Math.log(p), 0),
    differential: (q) => {
      const p = simplexWeights(q);
      return simplexBasis(q).map((dp) => -dp.reduce((sum, value, i) => sum + value * (Math.log(p[i]) + 1), 0)) as Vec2;
    },
  },
  {
    id: "option", category: "finance", name: "期权价格曲面", englishName: "Black–Scholes call",
    description: "每个点对应一组标的价格与波动率。期权价格形成曲面，局部敏感度把市场变动方向转换成价格变化。",
    coordinates: [
      { symbol: "m", label: "相对价格 S / K", range: [0.7, 1.3], step: 0.01, vectorLimit: 0.2, vectorStep: 0.01 },
      { symbol: "σ", label: "年化波动率（小数）", range: [0.1, 0.6], step: 0.01, vectorLimit: 0.2, vectorStep: 0.01 },
    ],
    initial: [1, 0.25], initialVector: [0.1, 0.05], axes: ["m = S/K", "σ", "C/K"],
    formula: "Φ(m, σ) = (m, σ, C(Km, σ)/K)", observable: "看涨期权价格", observableFormula: "f = C = S N(d₁) − K exp(−rT) N(d₂)", unit: "货币单位",
    interpretation: "α = dC = K·Delta dm + Vega dσ。Delta（价格敏感度）和 Vega（波动率敏感度）共同衡量价格变化。",
    convention: "European call（欧式看涨期权），K = 100、T = 1 年、r = 3%，无股息。σ 使用小数；1 个百分点为 0.01，Vega 按 σ 增加 1 计。图高为 C/K，读数为 C。",
    source: { label: "Black–Scholes & Greeks · Columbia", url: "https://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf" },
    embed: (q) => [q[0], q[1], callPrice(q) / 100],
    basis: (q) => { const d = callDifferential(q); return [[1, 0, d[0] / 100], [0, 1, d[1] / 100]]; },
    scalar: callPrice, differential: callDifferential,
  },
  {
    id: "portfolio", category: "finance", name: "投资组合风险曲面", englishName: "Portfolio variance",
    description: "把资金分给三个示例资产。权重之和固定为 1，曲面高度是组合方差；切向量描述一次保持总权重不变的调整。",
    coordinates: weightCoordinates, initial: [0.3, 0.45], initialVector: [0.2, 0.15], axes: ["w₁", "w₂", "Variance (%²)"],
    formula: "w = (u, (1−u)v, (1−u)(1−v)); Φ = (w₁, w₂, wᵀΣw)", observable: "组合方差", observableFormula: "f = wᵀΣw", unit: "%²",
    interpretation: "α = d(wᵀΣw) 衡量沿所选资金调整方向，组合方差的瞬时变化率；它已包含第三项权重的联动。",
    convention: "教学用假设资产，无做空。年化波动率为 12%、20%、28%；相关系数 ρ₁₂ = 0.20、ρ₁₃ = 0.10、ρ₂₃ = 0.25。Σ 按收益率百分点计。",
    source: { label: "Portfolio variance · William Sharpe", url: "https://web.stanford.edu/~wfsharpe/mia/rr/mia_rr4.htm" },
    embed: (q) => { const w = simplexWeights(q); return [w[0], w[1], portfolioVariance(q)]; },
    basis: (q) => { const d = portfolioDifferential(q); return [[1, -q[1], d[0]], [0, 1 - q[0], d[1]]]; },
    scalar: portfolioVariance, differential: portfolioDifferential,
  },
  {
    id: "sphere", category: "physics", name: "球面约束运动", englishName: "Motion on a sphere",
    description: "质点被限制在球面上。瞬时速度位于切平面内；重力势能的余向量衡量这个运动方向上，势能变化得有多快。",
    coordinates: [
      { symbol: "θ", label: "与向上竖直轴的夹角 / rad", range: [0.2, Math.PI - 0.2], step: 0.01, vectorLimit: 1.5, vectorStep: 0.05 },
      angle("φ", "绕竖直轴的方位角 / rad"),
    ],
    initial: [1.05, 0.6], initialVector: [0.5, 0.4], axes: ["x / m", "y / m", "z / m"],
    formula: "Φ(θ, φ) = (sin θ cos φ, sin θ sin φ, cos θ)", observable: "重力势能", observableFormula: "f = U = mgz = 9.81 cos θ", unit: "J",
    interpretation: "切向量是速度，α = dU 与它配对得到 dU/dt（势能变化率，W）。重力做功率为 −α(v)。",
    convention: "质量 1 kg、半径 1 m、g = 9.81 m/s²，z = 0 为势能零点。避开球坐标的两极；路径按当前角速度延伸，用于局部比较。",
    source: { label: "Constraints & configuration · Trinity College", url: "https://www.maths.tcd.ie/~hamiltlu/mechanics/ch1.pdf" },
    embed: ([u, v]) => [Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v), Math.cos(u)],
    basis: ([u, v]) => [[Math.cos(u) * Math.cos(v), Math.cos(u) * Math.sin(v), -Math.sin(u)], [-Math.sin(u) * Math.sin(v), Math.sin(u) * Math.cos(v), 0]],
    scalar: ([u]) => 9.81 * Math.cos(u), differential: ([u]) => [-9.81 * Math.sin(u), 0],
  },
  {
    id: "pendulum", category: "physics", name: "双摆的角度空间", englishName: "Double-pendulum torus",
    description: "两个摆角各自绕一圈，所有角度组合形成 Torus（环面）。移动环面上的点，对照实际摆形，观察两组角速度与势能的关系。",
    coordinates: [angle("θ₁", "第一根杆相对向下竖直线 / rad"), angle("θ₂", "第二根杆相对向下竖直线 / rad")],
    initial: [0.8, 0.6], initialVector: [0.65, -0.45], axes: ["Embedding x", "Embedding y", "Embedding z"],
    formula: "Φ = ((2 + 0.7 cos θ₂) cos θ₁, (2 + 0.7 cos θ₂) sin θ₁, 0.7 sin θ₂)",
    observable: "双摆势能", observableFormula: "f = U = 19.62(1−cos θ₁) + 9.81(1−cos θ₂)", unit: "J",
    interpretation: "切向量是一组瞬时角速度；α = dU 与它配对得到势能变化率（W）。两个角度均相对竖直线测量。",
    convention: "两质点各 1 kg，两无质量刚杆各 1 m，g = 9.81 m/s²。环面表现角度组合，形状不代表摆的空间轨迹或动力学度量。路径按当前角速度延伸，未求解动力学方程。",
    source: { label: "Double pendulum · UC Berkeley", url: "https://rotations.berkeley.edu/the-double-pendulum/" },
    embed: ([u, v]) => [(2 + 0.7 * Math.cos(v)) * Math.cos(u), (2 + 0.7 * Math.cos(v)) * Math.sin(u), 0.7 * Math.sin(v)],
    basis: ([u, v]) => [
      [-(2 + 0.7 * Math.cos(v)) * Math.sin(u), (2 + 0.7 * Math.cos(v)) * Math.cos(u), 0],
      [-0.7 * Math.sin(v) * Math.cos(u), -0.7 * Math.sin(v) * Math.sin(u), 0.7 * Math.cos(v)],
    ],
    scalar: ([u, v]) => 19.62 * (1 - Math.cos(u)) + 9.81 * (1 - Math.cos(v)),
    differential: ([u, v]) => [19.62 * Math.sin(u), 9.81 * Math.sin(v)],
  },
];

export function tangentVector(example: ManifoldExample, q: Vec2, components: Vec2): Vec3 {
  const [eu, ev] = example.basis(q);
  return add3(scale3(eu, components[0]), scale3(ev, components[1]));
}

/** Keep the comparison curve within the displayed coordinate patch. Angles wrap naturally. */
export function safeStep(example: ManifoldExample, q: Vec2, vector: Vec2, requested: number) {
  return Math.max(0, example.coordinates.reduce((h, coordinate, i) => {
    if (coordinate.periodic || Math.abs(vector[i]) < 1e-12) return h;
    const boundary = coordinate.range[vector[i] > 0 ? 1 : 0];
    return Math.min(h, Math.max(0, (boundary - q[i]) / vector[i]));
  }, requested));
}

export function localComparison(example: ManifoldExample, q: Vec2, vector: Vec2, requestedStep: number) {
  const step = safeStep(example, q, vector, requestedStep);
  const next: Vec2 = [q[0] + step * vector[0], q[1] + step * vector[1]];
  const rate = pair(example.differential(q), vector);
  const predicted = step * rate;
  const actual = example.scalar(next) - example.scalar(q);
  return { step, next, rate, predicted, actual, error: actual - predicted };
}
