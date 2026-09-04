import jStat from "jstat";

export type DistributionKind = "continuous" | "discrete";
export type DistributionFamily = "Foundations" | "Counts" | "Waiting time" | "Shape & scale" | "Heavy tails" | "Extreme values";
export type ParameterValues = Record<string, number>;

export interface ParameterDefinition {
  key: string;
  label: string;
  symbol: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  description?: string;
}

export interface Support {
  lower: number;
  upper: number;
  lowerClosed?: boolean;
  upperClosed?: boolean;
}

export type TailClass = "regular" | "heavy-nonregular" | "light" | "bounded" | "parameter-dependent";

export interface TailMetadata {
  classification: TailClass;
  exponent?: number;
  label: string;
  note: string;
}

export interface DistributionDefinition {
  id: string;
  name: string;
  chineseName: string;
  kind: DistributionKind;
  family: DistributionFamily;
  description: string;
  formula: string;
  parameters: ParameterDefinition[];
  density: (x: number, p: ParameterValues) => number;
  cdf: (x: number, p: ParameterValues) => number;
  quantile: (q: number, p: ParameterValues) => number;
  survival?: (x: number, p: ParameterValues) => number;
  support: (p: ParameterValues) => Support;
  mean: (p: ParameterValues) => number;
  variance: (p: ParameterValues) => number;
  tail: (p: ParameterValues) => TailMetadata;
  validate?: (p: ParameterValues) => string[];
}

const EPS = 1e-12;
const EULER_GAMMA = 0.5772156649015329;

const clampProbability = (q: number) => Math.min(1 - 1e-12, Math.max(1e-12, q));
const safePow = (base: number, exponent: number) => (base > 0 ? base ** exponent : Number.NaN);

const p = (
  key: string,
  label: string,
  symbol: string,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  description?: string,
  integer = false,
): ParameterDefinition => ({ key, label, symbol, defaultValue, min, max, step, description, integer });

const allReal: Support = { lower: Number.NEGATIVE_INFINITY, upper: Number.POSITIVE_INFINITY, lowerClosed: false, upperClosed: false };
const positive: Support = { lower: 0, upper: Number.POSITIVE_INFINITY, lowerClosed: true, upperClosed: false };
const nonNegativeIntegers: Support = { lower: 0, upper: Number.POSITIVE_INFINITY, lowerClosed: true, upperClosed: false };

const boundedTail = (note = "Finite support; there is no tail at positive infinity."): TailMetadata => ({
  classification: "bounded",
  label: "Bounded support",
  note,
});

const lightTail = (note = "The survival probability decays faster than a power law."): TailMetadata => ({
  classification: "light",
  label: "Light / rapidly varying tail",
  note,
});

const regularTail = (exponent: number, expression: string): TailMetadata => ({
  classification: "regular",
  exponent,
  label: `Regular variation · index ${formatTailExponent(exponent)}`,
  note: `The upper survival tail is asymptotically proportional to ${expression}.`,
});

const heavyNonRegular = (note: string): TailMetadata => ({
  classification: "heavy-nonregular",
  label: "Heavy tail · not regularly varying",
  note,
});

const quantileSearch = (
  q: number,
  cdf: (x: number) => number,
  lower: number,
  initialUpper: number,
  hardUpper = 100000,
) => {
  const target = clampProbability(q);
  let lo = Math.ceil(lower);
  let hi = Math.max(lo, Math.ceil(initialUpper));
  while (hi < hardUpper && cdf(hi) < target) hi = Math.min(hardUpper, Math.max(hi + 1, hi * 2));
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cdf(mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

export const distributions: DistributionDefinition[] = [
  {
    id: "normal",
    name: "Normal",
    chineseName: "正态分布",
    kind: "continuous",
    family: "Foundations",
    description: "The central location-scale model used throughout statistics and finance.",
    formula: "f(x) = exp(−(x−μ)²/(2σ²)) / (σ√(2π))",
    parameters: [
      p("mu", "Mean", "μ", 0, -10, 10, 0.1),
      p("sigma", "Std. deviation", "σ", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => jStat.normal.pdf(x, v.mu, v.sigma),
    cdf: (x, v) => jStat.normal.cdf(x, v.mu, v.sigma),
    quantile: (q, v) => jStat.normal.inv(clampProbability(q), v.mu, v.sigma),
    support: () => allReal,
    mean: (v) => v.mu,
    variance: (v) => v.sigma ** 2,
    tail: () => lightTail("The Gaussian survival tail is rapidly varying."),
  },
  {
    id: "lognormal",
    name: "Lognormal",
    chineseName: "对数正态分布",
    kind: "continuous",
    family: "Shape & scale",
    description: "A positive distribution where log(X) is Normal; μ and σ refer to log(X).",
    formula: "f(x) = exp(−(ln x−μ)²/(2σ²)) / (xσ√(2π))",
    parameters: [
      p("mu", "Log-mean", "μlog", 0, -5, 5, 0.1),
      p("sigma", "Log std. deviation", "σlog", 0.6, 0.05, 3, 0.05),
    ],
    density: (x, v) => (x > 0 ? jStat.lognormal.pdf(x, v.mu, v.sigma) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.lognormal.cdf(x, v.mu, v.sigma)),
    quantile: (q, v) => jStat.lognormal.inv(clampProbability(q), v.mu, v.sigma),
    support: () => positive,
    mean: (v) => Math.exp(v.mu + v.sigma ** 2 / 2),
    variance: (v) => (Math.exp(v.sigma ** 2) - 1) * Math.exp(2 * v.mu + v.sigma ** 2),
    tail: () => heavyNonRegular("Lognormal is heavy-tailed and subexponential, but its survival tail is not regularly varying."),
  },
  {
    id: "gamma",
    name: "Gamma",
    chineseName: "伽马分布",
    kind: "continuous",
    family: "Waiting time",
    description: "A flexible positive model for waiting times and aggregate positive quantities.",
    formula: "f(x) = xᵏ⁻¹ exp(−x/θ) / (Γ(k) θᵏ)",
    parameters: [
      p("shape", "Shape", "k", 2, 0.1, 20, 0.1),
      p("scale", "Scale", "θ", 1, 0.05, 10, 0.05, "Rate β equals 1/θ."),
    ],
    density: (x, v) => (x >= 0 ? jStat.gamma.pdf(x, v.shape, v.scale) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.gamma.cdf(x, v.shape, v.scale)),
    quantile: (q, v) => jStat.gamma.inv(clampProbability(q), v.shape, v.scale),
    support: () => positive,
    mean: (v) => v.shape * v.scale,
    variance: (v) => v.shape * v.scale ** 2,
    tail: () => lightTail("The Gamma survival tail has exponential decay."),
  },
  {
    id: "beta",
    name: "Beta",
    chineseName: "贝塔分布",
    kind: "continuous",
    family: "Shape & scale",
    description: "A bounded model for probabilities and proportions.",
    formula: "f(x) = xᵅ⁻¹(1−x)ᵝ⁻¹ / B(α,β)",
    parameters: [
      p("alpha", "Shape 1", "α", 2, 0.1, 20, 0.1),
      p("beta", "Shape 2", "β", 5, 0.1, 20, 0.1),
    ],
    density: (x, v) => (x >= 0 && x <= 1 ? jStat.beta.pdf(x, v.alpha, v.beta) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : x >= 1 ? 1 : jStat.beta.cdf(x, v.alpha, v.beta)),
    quantile: (q, v) => jStat.beta.inv(clampProbability(q), v.alpha, v.beta),
    support: () => ({ lower: 0, upper: 1, lowerClosed: true, upperClosed: true }),
    mean: (v) => v.alpha / (v.alpha + v.beta),
    variance: (v) => (v.alpha * v.beta) / ((v.alpha + v.beta) ** 2 * (v.alpha + v.beta + 1)),
    tail: () => boundedTail(),
  },
  {
    id: "exponential",
    name: "Exponential",
    chineseName: "指数分布",
    kind: "continuous",
    family: "Waiting time",
    description: "The memoryless positive waiting-time model, parameterized by rate λ.",
    formula: "f(x) = λ exp(−λx)",
    parameters: [p("rate", "Rate", "λ", 1, 0.05, 10, 0.05, "Scale equals 1/λ.")],
    density: (x, v) => (x >= 0 ? jStat.exponential.pdf(x, v.rate) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.exponential.cdf(x, v.rate)),
    quantile: (q, v) => jStat.exponential.inv(clampProbability(q), v.rate),
    survival: (x, v) => (x < 0 ? 1 : Math.exp(-v.rate * x)),
    support: () => positive,
    mean: (v) => 1 / v.rate,
    variance: (v) => 1 / v.rate ** 2,
    tail: () => lightTail("The Exponential survival tail decays as exp(−λx)."),
  },
  {
    id: "student-t",
    name: "Student’s t",
    chineseName: "学生 t 分布",
    kind: "continuous",
    family: "Heavy tails",
    description: "A symmetric heavy-tailed location-scale model; ν controls tail thickness.",
    formula: "f(x) ∝ [1 + ((x−μ)/s)²/ν]⁻⁽ᵛ⁺¹⁾⁄² / s",
    parameters: [
      p("nu", "Degrees of freedom", "ν", 5, 0.5, 100, 0.5),
      p("mu", "Location", "μ", 0, -10, 10, 0.1),
      p("scale", "Scale", "s", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => jStat.studentt.pdf((x - v.mu) / v.scale, v.nu) / v.scale,
    cdf: (x, v) => jStat.studentt.cdf((x - v.mu) / v.scale, v.nu),
    quantile: (q, v) => v.mu + v.scale * jStat.studentt.inv(clampProbability(q), v.nu),
    support: () => allReal,
    mean: (v) => (v.nu > 1 ? v.mu : Number.NaN),
    variance: (v) => (v.nu > 2 ? (v.scale ** 2 * v.nu) / (v.nu - 2) : Number.POSITIVE_INFINITY),
    tail: (v) => regularTail(-v.nu, `x⁻${formatCompact(v.nu)}`),
  },
  {
    id: "chi-square",
    name: "Chi-square",
    chineseName: "卡方分布",
    kind: "continuous",
    family: "Foundations",
    description: "The distribution of a sum of squared standard Normal variables.",
    formula: "f(x) = xᵛ⁄²⁻¹ exp(−x/2) / (2ᵛ⁄² Γ(ν/2))",
    parameters: [p("nu", "Degrees of freedom", "ν", 5, 0.2, 100, 0.2)],
    density: (x, v) => (x >= 0 ? jStat.chisquare.pdf(x, v.nu) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.chisquare.cdf(x, v.nu)),
    quantile: (q, v) => jStat.chisquare.inv(clampProbability(q), v.nu),
    support: () => positive,
    mean: (v) => v.nu,
    variance: (v) => 2 * v.nu,
    tail: () => lightTail("The Chi-square survival tail has exponential decay."),
  },
  {
    id: "weibull",
    name: "Weibull",
    chineseName: "威布尔分布",
    kind: "continuous",
    family: "Waiting time",
    description: "A duration and reliability model with shape-dependent hazard behavior.",
    formula: "f(x) = (k/λ)(x/λ)ᵏ⁻¹ exp(−(x/λ)ᵏ)",
    parameters: [
      p("shape", "Shape", "k", 1.5, 0.1, 10, 0.1),
      p("scale", "Scale", "λ", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => (x >= 0 ? jStat.weibull.pdf(x, v.scale, v.shape) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.weibull.cdf(x, v.scale, v.shape)),
    quantile: (q, v) => jStat.weibull.inv(clampProbability(q), v.scale, v.shape),
    survival: (x, v) => (x < 0 ? 1 : Math.exp(-((x / v.scale) ** v.shape))),
    support: () => positive,
    mean: (v) => v.scale * jStat.gammafn(1 + 1 / v.shape),
    variance: (v) => v.scale ** 2 * (jStat.gammafn(1 + 2 / v.shape) - jStat.gammafn(1 + 1 / v.shape) ** 2),
    tail: (v) =>
      v.shape < 1
        ? heavyNonRegular("A stretched-exponential Weibull tail is heavy in the MGF sense, but is not regularly varying.")
        : lightTail("The Weibull survival tail is exponential or faster when k ≥ 1."),
  },
  {
    id: "f",
    name: "F-distribution",
    chineseName: "F 分布",
    kind: "continuous",
    family: "Foundations",
    description: "A ratio distribution used in variance comparisons and model tests.",
    formula: "f(x) ∝ xᵈ¹⁄²⁻¹ (1 + d₁x/d₂)⁻⁽ᵈ¹⁺ᵈ²⁾⁄²",
    parameters: [
      p("df1", "Numerator df", "d₁", 5, 0.5, 100, 0.5),
      p("df2", "Denominator df", "d₂", 10, 0.5, 100, 0.5),
    ],
    density: (x, v) => (x >= 0 ? jStat.centralF.pdf(x, v.df1, v.df2) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.centralF.cdf(x, v.df1, v.df2)),
    quantile: (q, v) => jStat.centralF.inv(clampProbability(q), v.df1, v.df2),
    support: () => positive,
    mean: (v) => (v.df2 > 2 ? v.df2 / (v.df2 - 2) : Number.POSITIVE_INFINITY),
    variance: (v) =>
      v.df2 > 4
        ? (2 * v.df2 ** 2 * (v.df1 + v.df2 - 2)) / (v.df1 * (v.df2 - 2) ** 2 * (v.df2 - 4))
        : Number.POSITIVE_INFINITY,
    tail: (v) => regularTail(-v.df2 / 2, `x⁻${formatCompact(v.df2 / 2)}`),
  },
  {
    id: "pareto",
    name: "Pareto Type I",
    chineseName: "帕累托 I 型分布",
    kind: "continuous",
    family: "Heavy tails",
    description: "A canonical power-law model for upper-tail size and loss severity.",
    formula: "f(x) = αxₘᵅ / xᵅ⁺¹,  x ≥ xₘ",
    parameters: [
      p("scale", "Minimum", "xₘ", 1, 0.05, 20, 0.05),
      p("shape", "Tail shape", "α", 2.5, 0.2, 10, 0.1),
    ],
    density: (x, v) => (x >= v.scale ? jStat.pareto.pdf(x, v.scale, v.shape) : 0),
    cdf: (x, v) => (x < v.scale ? 0 : jStat.pareto.cdf(x, v.scale, v.shape)),
    quantile: (q, v) => v.scale / (1 - clampProbability(q)) ** (1 / v.shape),
    survival: (x, v) => (x < v.scale ? 1 : (v.scale / x) ** v.shape),
    support: (v) => ({ lower: v.scale, upper: Number.POSITIVE_INFINITY, lowerClosed: true }),
    mean: (v) => (v.shape > 1 ? (v.shape * v.scale) / (v.shape - 1) : Number.POSITIVE_INFINITY),
    variance: (v) =>
      v.shape > 2 ? (v.scale ** 2 * v.shape) / ((v.shape - 1) ** 2 * (v.shape - 2)) : Number.POSITIVE_INFINITY,
    tail: (v) => regularTail(-v.shape, `x⁻${formatCompact(v.shape)}`),
  },
  {
    id: "power-function",
    name: "Power function",
    chineseName: "幂函数分布",
    kind: "continuous",
    family: "Shape & scale",
    description: "The bounded power-function distribution on [0,b], distinct from a power-law tail.",
    formula: "f(x) = axᵃ⁻¹ / bᵃ,  0 ≤ x ≤ b",
    parameters: [
      p("shape", "Shape", "a", 2, 0.1, 20, 0.1),
      p("upper", "Upper bound", "b", 1, 0.1, 20, 0.1),
    ],
    density: (x, v) => (x >= 0 && x <= v.upper ? (v.shape * x ** (v.shape - 1)) / v.upper ** v.shape : 0),
    cdf: (x, v) => (x <= 0 ? 0 : x >= v.upper ? 1 : (x / v.upper) ** v.shape),
    quantile: (q, v) => v.upper * clampProbability(q) ** (1 / v.shape),
    survival: (x, v) => (x <= 0 ? 1 : x >= v.upper ? 0 : 1 - (x / v.upper) ** v.shape),
    support: (v) => ({ lower: 0, upper: v.upper, lowerClosed: true, upperClosed: true }),
    mean: (v) => (v.upper * v.shape) / (v.shape + 1),
    variance: (v) => (v.upper ** 2 * v.shape) / ((v.shape + 1) ** 2 * (v.shape + 2)),
    tail: () => boundedTail("Power function is bounded and should not be confused with a regularly varying power-law tail."),
  },
  {
    id: "poisson",
    name: "Poisson",
    chineseName: "泊松分布",
    kind: "discrete",
    family: "Counts",
    description: "A count model for independent events occurring at a constant average rate.",
    formula: "P(X=k) = exp(−λ) λᵏ / k!",
    parameters: [p("rate", "Rate", "λ", 4, 0.05, 100, 0.05)],
    density: (x, v) => (Number.isInteger(x) && x >= 0 ? jStat.poisson.pdf(x, v.rate) : 0),
    cdf: (x, v) => (x < 0 ? 0 : jStat.poisson.cdf(Math.floor(x), v.rate)),
    quantile: (q, v) => quantileSearch(q, (x) => jStat.poisson.cdf(x, v.rate), 0, v.rate + 12 * Math.sqrt(v.rate) + 12),
    support: () => nonNegativeIntegers,
    mean: (v) => v.rate,
    variance: (v) => v.rate,
    tail: () => lightTail("The Poisson upper tail decays faster than a power law."),
  },
  {
    id: "binomial",
    name: "Binomial",
    chineseName: "二项分布",
    kind: "discrete",
    family: "Counts",
    description: "The number of successes in n independent Bernoulli trials.",
    formula: "P(X=k) = C(n,k) pᵏ(1−p)ⁿ⁻ᵏ",
    parameters: [
      p("n", "Trials", "n", 20, 1, 300, 1, undefined, true),
      p("prob", "Success probability", "p", 0.4, 0.01, 0.99, 0.01),
    ],
    density: (x, v) => (Number.isInteger(x) && x >= 0 && x <= v.n ? jStat.binomial.pdf(x, v.n, v.prob) : 0),
    cdf: (x, v) => (x < 0 ? 0 : x >= v.n ? 1 : jStat.binomial.cdf(Math.floor(x), v.n, v.prob)),
    quantile: (q, v) => quantileSearch(q, (x) => jStat.binomial.cdf(x, v.n, v.prob), 0, v.n, v.n),
    support: (v) => ({ lower: 0, upper: v.n, lowerClosed: true, upperClosed: true }),
    mean: (v) => v.n * v.prob,
    variance: (v) => v.n * v.prob * (1 - v.prob),
    tail: () => boundedTail(),
  },
  {
    id: "negative-binomial",
    name: "Negative Binomial",
    chineseName: "负二项分布",
    kind: "discrete",
    family: "Counts",
    description: "Failures observed before the r-th success; p is the success probability on each trial.",
    formula: "P(X=k) = C(k+r−1,k) pʳ(1−p)ᵏ",
    parameters: [
      p("r", "Required successes", "r", 5, 1, 100, 1, "X counts failures before the r-th success.", true),
      p("prob", "Success probability", "p", 0.45, 0.01, 0.99, 0.01),
    ],
    density: (x, v) => (Number.isInteger(x) && x >= 0 ? jStat.negbin.pdf(x, v.r, v.prob) : 0),
    cdf: (x, v) => (x < 0 ? 0 : jStat.negbin.cdf(Math.floor(x), v.r, v.prob)),
    quantile: (q, v) => {
      const mean = (v.r * (1 - v.prob)) / v.prob;
      const sd = Math.sqrt((v.r * (1 - v.prob)) / v.prob ** 2);
      return quantileSearch(q, (x) => jStat.negbin.cdf(x, v.r, v.prob), 0, mean + 12 * sd + 12);
    },
    support: () => nonNegativeIntegers,
    mean: (v) => (v.r * (1 - v.prob)) / v.prob,
    variance: (v) => (v.r * (1 - v.prob)) / v.prob ** 2,
    tail: () => lightTail("For fixed r and p, the Negative Binomial tail has geometric decay."),
  },
  {
    id: "hypergeometric",
    name: "Hypergeometric",
    chineseName: "超几何分布",
    kind: "discrete",
    family: "Counts",
    description: "Successes in sampling without replacement from a finite population.",
    formula: "P(X=k) = C(K,k)C(N−K,n−k) / C(N,n)",
    parameters: [
      p("population", "Population", "N", 50, 1, 500, 1, undefined, true),
      p("successes", "Population successes", "K", 18, 0, 500, 1, undefined, true),
      p("draws", "Draws", "n", 12, 0, 500, 1, undefined, true),
    ],
    density: (x, v) =>
      Number.isInteger(x) ? jStat.hypgeom.pdf(x, v.population, v.successes, v.draws) : 0,
    cdf: (x, v) => {
      const lower = Math.max(0, v.draws - (v.population - v.successes));
      const upper = Math.min(v.draws, v.successes);
      return x < lower ? 0 : x >= upper ? 1 : jStat.hypgeom.cdf(Math.floor(x), v.population, v.successes, v.draws);
    },
    quantile: (q, v) => {
      const lower = Math.max(0, v.draws - (v.population - v.successes));
      const upper = Math.min(v.draws, v.successes);
      return quantileSearch(q, (x) => jStat.hypgeom.cdf(x, v.population, v.successes, v.draws), lower, upper, upper);
    },
    support: (v) => ({
      lower: Math.max(0, v.draws - (v.population - v.successes)),
      upper: Math.min(v.draws, v.successes),
      lowerClosed: true,
      upperClosed: true,
    }),
    mean: (v) => (v.draws * v.successes) / v.population,
    variance: (v) =>
      v.population > 1
        ? v.draws * (v.successes / v.population) * (1 - v.successes / v.population) * ((v.population - v.draws) / (v.population - 1))
        : 0,
    tail: () => boundedTail(),
    validate: (v) => {
      const errors: string[] = [];
      if (v.successes > v.population) errors.push("K cannot exceed population N.");
      if (v.draws > v.population) errors.push("Draws n cannot exceed population N.");
      return errors;
    },
  },
  {
    id: "uniform",
    name: "Uniform",
    chineseName: "均匀分布",
    kind: "continuous",
    family: "Foundations",
    description: "A constant-density baseline on a finite interval.",
    formula: "f(x) = 1/(b−a),  a ≤ x ≤ b",
    parameters: [
      p("lower", "Lower bound", "a", 0, -20, 20, 0.1),
      p("upper", "Upper bound", "b", 1, -20, 20, 0.1),
    ],
    density: (x, v) => (x >= v.lower && x <= v.upper ? 1 / (v.upper - v.lower) : 0),
    cdf: (x, v) => (x <= v.lower ? 0 : x >= v.upper ? 1 : (x - v.lower) / (v.upper - v.lower)),
    quantile: (q, v) => v.lower + clampProbability(q) * (v.upper - v.lower),
    survival: (x, v) => (x <= v.lower ? 1 : x >= v.upper ? 0 : (v.upper - x) / (v.upper - v.lower)),
    support: (v) => ({ lower: v.lower, upper: v.upper, lowerClosed: true, upperClosed: true }),
    mean: (v) => (v.lower + v.upper) / 2,
    variance: (v) => (v.upper - v.lower) ** 2 / 12,
    tail: () => boundedTail(),
    validate: (v) => (v.upper > v.lower ? [] : ["Upper bound b must be greater than lower bound a."]),
  },
  {
    id: "bernoulli",
    name: "Bernoulli",
    chineseName: "伯努利分布",
    kind: "discrete",
    family: "Counts",
    description: "A single success/failure trial.",
    formula: "P(X=x) = pˣ(1−p)¹⁻ˣ,  x ∈ {0,1}",
    parameters: [p("prob", "Success probability", "p", 0.4, 0.01, 0.99, 0.01)],
    density: (x, v) => (x === 1 ? v.prob : x === 0 ? 1 - v.prob : 0),
    cdf: (x, v) => (x < 0 ? 0 : x < 1 ? 1 - v.prob : 1),
    quantile: (q, v) => (q <= 1 - v.prob ? 0 : 1),
    support: () => ({ lower: 0, upper: 1, lowerClosed: true, upperClosed: true }),
    mean: (v) => v.prob,
    variance: (v) => v.prob * (1 - v.prob),
    tail: () => boundedTail(),
  },
  {
    id: "geometric",
    name: "Geometric",
    chineseName: "几何分布",
    kind: "discrete",
    family: "Waiting time",
    description: "Failures before the first success, with per-trial success probability p.",
    formula: "P(X=k) = p(1−p)ᵏ,  k = 0,1,…",
    parameters: [p("prob", "Success probability", "p", 0.35, 0.01, 0.99, 0.01)],
    density: (x, v) => (Number.isInteger(x) && x >= 0 ? v.prob * (1 - v.prob) ** x : 0),
    cdf: (x, v) => (x < 0 ? 0 : 1 - (1 - v.prob) ** (Math.floor(x) + 1)),
    quantile: (q, v) => Math.max(0, Math.ceil(Math.log(1 - clampProbability(q)) / Math.log(1 - v.prob) - 1)),
    survival: (x, v) => (x < 0 ? 1 : (1 - v.prob) ** (Math.floor(x) + 1)),
    support: () => nonNegativeIntegers,
    mean: (v) => (1 - v.prob) / v.prob,
    variance: (v) => (1 - v.prob) / v.prob ** 2,
    tail: () => lightTail("The Geometric survival tail decays exponentially in k."),
  },
  {
    id: "cauchy",
    name: "Cauchy",
    chineseName: "柯西分布",
    kind: "continuous",
    family: "Heavy tails",
    description: "A symmetric heavy-tailed model whose mean and variance do not exist.",
    formula: "f(x) = 1 / [πs(1+((x−x₀)/s)²)]",
    parameters: [
      p("location", "Location", "x₀", 0, -10, 10, 0.1),
      p("scale", "Scale", "s", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => jStat.cauchy.pdf(x, v.location, v.scale),
    cdf: (x, v) => jStat.cauchy.cdf(x, v.location, v.scale),
    quantile: (q, v) => v.location + v.scale * Math.tan(Math.PI * (clampProbability(q) - 0.5)),
    survival: (x, v) => 0.5 - Math.atan((x - v.location) / v.scale) / Math.PI,
    support: () => allReal,
    mean: () => Number.NaN,
    variance: () => Number.NaN,
    tail: () => regularTail(-1, "x⁻¹"),
  },
  {
    id: "laplace",
    name: "Laplace",
    chineseName: "拉普拉斯分布",
    kind: "continuous",
    family: "Shape & scale",
    description: "A symmetric, sharper-peaked alternative to Normal with exponential tails.",
    formula: "f(x) = exp(−|x−μ|/b) / (2b)",
    parameters: [
      p("location", "Location", "μ", 0, -10, 10, 0.1),
      p("scale", "Scale", "b", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => Math.exp(-Math.abs(x - v.location) / v.scale) / (2 * v.scale),
    cdf: (x, v) =>
      x < v.location
        ? 0.5 * Math.exp((x - v.location) / v.scale)
        : 1 - 0.5 * Math.exp(-(x - v.location) / v.scale),
    quantile: (q, v) => {
      const probability = clampProbability(q);
      return probability < 0.5
        ? v.location + v.scale * Math.log(2 * probability)
        : v.location - v.scale * Math.log(2 * (1 - probability));
    },
    survival: (x, v) =>
      x < v.location
        ? 1 - 0.5 * Math.exp((x - v.location) / v.scale)
        : 0.5 * Math.exp(-(x - v.location) / v.scale),
    support: () => allReal,
    mean: (v) => v.location,
    variance: (v) => 2 * v.scale ** 2,
    tail: () => lightTail("The Laplace survival tail has exponential decay."),
  },
  {
    id: "logistic",
    name: "Logistic",
    chineseName: "逻辑斯蒂分布",
    kind: "continuous",
    family: "Shape & scale",
    description: "A symmetric location-scale distribution with a closed-form sigmoid CDF.",
    formula: "F(x) = 1 / (1 + exp(−(x−μ)/s))",
    parameters: [
      p("location", "Location", "μ", 0, -10, 10, 0.1),
      p("scale", "Scale", "s", 1, 0.05, 10, 0.05),
    ],
    density: (x, v) => {
      const z = Math.exp(-(x - v.location) / v.scale);
      return z / (v.scale * (1 + z) ** 2);
    },
    cdf: (x, v) => 1 / (1 + Math.exp(-(x - v.location) / v.scale)),
    quantile: (q, v) => {
      const probability = clampProbability(q);
      return v.location + v.scale * Math.log(probability / (1 - probability));
    },
    survival: (x, v) => 1 / (1 + Math.exp((x - v.location) / v.scale)),
    support: () => allReal,
    mean: (v) => v.location,
    variance: (v) => (Math.PI ** 2 * v.scale ** 2) / 3,
    tail: () => lightTail("The Logistic survival tail has exponential decay."),
  },
  {
    id: "inverse-gamma",
    name: "Inverse Gamma",
    chineseName: "逆伽马分布",
    kind: "continuous",
    family: "Heavy tails",
    description: "A positive heavy-tailed distribution often used for variance priors.",
    formula: "f(x) = βᵅ x⁻ᵅ⁻¹ exp(−β/x) / Γ(α)",
    parameters: [
      p("shape", "Shape", "α", 3.5, 0.2, 20, 0.1),
      p("scale", "Scale", "β", 2, 0.05, 20, 0.05),
    ],
    density: (x, v) => (x > 0 ? jStat.invgamma.pdf(x, v.shape, v.scale) : 0),
    cdf: (x, v) => (x <= 0 ? 0 : jStat.invgamma.cdf(x, v.shape, v.scale)),
    quantile: (q, v) => jStat.invgamma.inv(clampProbability(q), v.shape, v.scale),
    support: () => positive,
    mean: (v) => (v.shape > 1 ? v.scale / (v.shape - 1) : Number.POSITIVE_INFINITY),
    variance: (v) =>
      v.shape > 2 ? v.scale ** 2 / ((v.shape - 1) ** 2 * (v.shape - 2)) : Number.POSITIVE_INFINITY,
    tail: (v) => regularTail(-v.shape, `x⁻${formatCompact(v.shape)}`),
  },
  {
    id: "triangular",
    name: "Triangular",
    chineseName: "三角分布",
    kind: "continuous",
    family: "Foundations",
    description: "A bounded model defined by a minimum, most-likely value, and maximum.",
    formula: "Piecewise linear density on [a,b] with mode c",
    parameters: [
      p("lower", "Minimum", "a", 0, -20, 20, 0.1),
      p("mode", "Mode", "c", 0.4, -20, 20, 0.1),
      p("upper", "Maximum", "b", 1, -20, 20, 0.1),
    ],
    density: (x, v) => (x >= v.lower && x <= v.upper ? jStat.triangular.pdf(x, v.lower, v.upper, v.mode) : 0),
    cdf: (x, v) => (x <= v.lower ? 0 : x >= v.upper ? 1 : jStat.triangular.cdf(x, v.lower, v.upper, v.mode)),
    quantile: (q, v) => {
      const probability = clampProbability(q);
      const split = (v.mode - v.lower) / (v.upper - v.lower);
      return probability < split
        ? v.lower + Math.sqrt(probability * (v.upper - v.lower) * (v.mode - v.lower))
        : v.upper - Math.sqrt((1 - probability) * (v.upper - v.lower) * (v.upper - v.mode));
    },
    support: (v) => ({ lower: v.lower, upper: v.upper, lowerClosed: true, upperClosed: true }),
    mean: (v) => (v.lower + v.mode + v.upper) / 3,
    variance: (v) =>
      (v.lower ** 2 + v.mode ** 2 + v.upper ** 2 - v.lower * v.mode - v.lower * v.upper - v.mode * v.upper) / 18,
    tail: () => boundedTail(),
    validate: (v) => (v.lower <= v.mode && v.mode <= v.upper && v.lower < v.upper ? [] : ["Require a ≤ c ≤ b and a < b."]),
  },
  {
    id: "gev",
    name: "Generalized Extreme Value",
    chineseName: "广义极值分布",
    kind: "continuous",
    family: "Extreme values",
    description: "A unified model for block maxima; ξ determines Gumbel, Fréchet, or bounded-tail behavior.",
    formula: "F(x) = exp{−[1+ξ(x−μ)/σ]⁻¹⁄ξ}",
    parameters: [
      p("location", "Location", "μ", 0, -10, 10, 0.1),
      p("scale", "Scale", "σ", 1, 0.05, 10, 0.05),
      p("shape", "Shape", "ξ", 0.15, -0.8, 0.9, 0.01),
    ],
    density: (x, v) => gevDensity(x, v.location, v.scale, v.shape),
    cdf: (x, v) => gevCdf(x, v.location, v.scale, v.shape),
    quantile: (q, v) => gevQuantile(q, v.location, v.scale, v.shape),
    survival: (x, v) => Math.max(0, -Math.expm1(-gevExponent(x, v.location, v.scale, v.shape))),
    support: (v) =>
      v.shape > EPS
        ? { lower: v.location - v.scale / v.shape, upper: Number.POSITIVE_INFINITY }
        : v.shape < -EPS
          ? { lower: Number.NEGATIVE_INFINITY, upper: v.location - v.scale / v.shape }
          : allReal,
    mean: (v) => {
      if (v.shape >= 1) return Number.POSITIVE_INFINITY;
      return Math.abs(v.shape) < EPS
        ? v.location + EULER_GAMMA * v.scale
        : v.location + (v.scale * (jStat.gammafn(1 - v.shape) - 1)) / v.shape;
    },
    variance: (v) => {
      if (v.shape >= 0.5) return Number.POSITIVE_INFINITY;
      return Math.abs(v.shape) < EPS
        ? (Math.PI ** 2 * v.scale ** 2) / 6
        : (v.scale ** 2 * (jStat.gammafn(1 - 2 * v.shape) - jStat.gammafn(1 - v.shape) ** 2)) / v.shape ** 2;
    },
    tail: (v) =>
      v.shape > 0
        ? regularTail(-1 / v.shape, `x⁻${formatCompact(1 / v.shape)}`)
        : v.shape < 0
          ? boundedTail("A negative GEV shape has a finite upper endpoint.")
          : lightTail("The Gumbel case ξ = 0 has an exponentially decaying upper tail."),
  },
  {
    id: "gpd",
    name: "Generalized Pareto",
    chineseName: "广义帕累托分布",
    kind: "continuous",
    family: "Extreme values",
    description: "The standard peaks-over-threshold model for excess losses above u.",
    formula: "F(x) = 1 − [1+ξ(x−u)/β]⁻¹⁄ξ",
    parameters: [
      p("location", "Threshold", "u", 0, -10, 10, 0.1),
      p("scale", "Scale", "β", 1, 0.05, 10, 0.05),
      p("shape", "Shape", "ξ", 0.25, -0.8, 1.2, 0.01),
    ],
    density: (x, v) => gpdDensity(x, v.location, v.scale, v.shape),
    cdf: (x, v) => gpdCdf(x, v.location, v.scale, v.shape),
    quantile: (q, v) => gpdQuantile(q, v.location, v.scale, v.shape),
    survival: (x, v) => gpdSurvival(x, v.location, v.scale, v.shape),
    support: (v) => ({
      lower: v.location,
      upper: v.shape < 0 ? v.location - v.scale / v.shape : Number.POSITIVE_INFINITY,
      lowerClosed: true,
    }),
    mean: (v) => (v.shape < 1 ? v.location + v.scale / (1 - v.shape) : Number.POSITIVE_INFINITY),
    variance: (v) =>
      v.shape < 0.5 ? v.scale ** 2 / ((1 - v.shape) ** 2 * (1 - 2 * v.shape)) : Number.POSITIVE_INFINITY,
    tail: (v) =>
      v.shape > 0
        ? regularTail(-1 / v.shape, `x⁻${formatCompact(1 / v.shape)}`)
        : v.shape < 0
          ? boundedTail("A negative GPD shape has a finite upper endpoint.")
          : lightTail("The ξ = 0 limit is Exponential."),
  },
];

function gevExponent(x: number, location: number, scale: number, shape: number) {
  const z = (x - location) / scale;
  if (Math.abs(shape) < EPS) return Math.exp(-z);
  const t = 1 + shape * z;
  if (t <= 0) return shape > 0 ? Number.POSITIVE_INFINITY : 0;
  return t ** (-1 / shape);
}

function gevCdf(x: number, location: number, scale: number, shape: number) {
  if (Math.abs(shape) >= EPS && 1 + shape * ((x - location) / scale) <= 0) return shape > 0 ? 0 : 1;
  return Math.exp(-gevExponent(x, location, scale, shape));
}

function gevDensity(x: number, location: number, scale: number, shape: number) {
  const z = (x - location) / scale;
  if (Math.abs(shape) < EPS) return Math.exp(-(z + Math.exp(-z))) / scale;
  const t = 1 + shape * z;
  if (t <= 0) return 0;
  const exponent = t ** (-1 / shape);
  return (t ** (-1 / shape - 1) * Math.exp(-exponent)) / scale;
}

function gevQuantile(q: number, location: number, scale: number, shape: number) {
  const probability = clampProbability(q);
  if (Math.abs(shape) < EPS) return location - scale * Math.log(-Math.log(probability));
  return location + (scale / shape) * ((-Math.log(probability)) ** -shape - 1);
}

function gpdValid(x: number, location: number, scale: number, shape: number) {
  return x >= location && (Math.abs(shape) < EPS || 1 + (shape * (x - location)) / scale > 0);
}

function gpdDensity(x: number, location: number, scale: number, shape: number) {
  if (!gpdValid(x, location, scale, shape)) return 0;
  const z = (x - location) / scale;
  return Math.abs(shape) < EPS ? Math.exp(-z) / scale : safePow(1 + shape * z, -1 / shape - 1) / scale;
}

function gpdCdf(x: number, location: number, scale: number, shape: number) {
  if (x < location) return 0;
  if (shape < 0 && x >= location - scale / shape) return 1;
  const z = (x - location) / scale;
  return Math.abs(shape) < EPS ? 1 - Math.exp(-z) : 1 - safePow(1 + shape * z, -1 / shape);
}

function gpdSurvival(x: number, location: number, scale: number, shape: number) {
  if (x < location) return 1;
  if (shape < 0 && x >= location - scale / shape) return 0;
  const z = (x - location) / scale;
  return Math.abs(shape) < EPS ? Math.exp(-z) : safePow(1 + shape * z, -1 / shape);
}

function gpdQuantile(q: number, location: number, scale: number, shape: number) {
  const probability = clampProbability(q);
  return Math.abs(shape) < EPS
    ? location - scale * Math.log(1 - probability)
    : location + (scale / shape) * ((1 - probability) ** -shape - 1);
}

export const distributionById = (id: string) => distributions.find((item) => item.id === id) ?? distributions[0];

export const defaultParameters = (definition: DistributionDefinition): ParameterValues =>
  Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue]));

export const validateParameters = (definition: DistributionDefinition, values: ParameterValues) => {
  const errors = definition.parameters.flatMap((parameter) => {
    const value = values[parameter.key];
    if (!Number.isFinite(value)) return [`${parameter.label} must be a finite number.`];
    if (value < parameter.min || value > parameter.max) return [`${parameter.label} must be between ${parameter.min} and ${parameter.max}.`];
    if (parameter.integer && !Number.isInteger(value)) return [`${parameter.label} must be an integer.`];
    return [];
  });
  return [...errors, ...(definition.validate?.(values) ?? [])];
};

export const safeDensity = (definition: DistributionDefinition, x: number, values: ParameterValues) => {
  const value = definition.density(x, values);
  return Number.isNaN(value) || value < 0 ? 0 : value;
};

export const safeCdf = (definition: DistributionDefinition, x: number, values: ParameterValues) => {
  const value = definition.cdf(x, values);
  return Number.isNaN(value) ? Number.NaN : Math.min(1, Math.max(0, value));
};

export const survival = (definition: DistributionDefinition, x: number, values: ParameterValues) => {
  const value = definition.survival?.(x, values) ?? 1 - safeCdf(definition, x, values);
  return Number.isNaN(value) ? Number.NaN : Math.min(1, Math.max(0, value));
};

export const automaticDomain = (definition: DistributionDefinition, values: ParameterValues, tailProbability = 0.995): [number, number] => {
  const support = definition.support(values);
  if (definition.kind === "discrete") {
    const lower = Number.isFinite(support.lower) ? support.lower : definition.quantile(1 - tailProbability, values);
    const upper = Number.isFinite(support.upper) ? support.upper : definition.quantile(tailProbability, values);
    return [Math.floor(finiteOr(lower, 0)), Math.ceil(finiteOr(upper, 20))];
  }

  let lower = Number.isFinite(support.lower) ? support.lower : definition.quantile(1 - tailProbability, values);
  let upper = Number.isFinite(support.upper) ? support.upper : definition.quantile(tailProbability, values);
  lower = finiteOr(lower, -5);
  upper = finiteOr(upper, 5);
  if (!(upper > lower)) return [lower - 1, lower + 1];
  const span = upper - lower;
  if (!Number.isFinite(support.lower)) lower -= span * 0.04;
  if (!Number.isFinite(support.upper)) upper += span * 0.04;
  return [lower, upper];
};

export const sampleDistribution = (
  definition: DistributionDefinition,
  values: ParameterValues,
  domain?: [number, number],
  points = 360,
) => {
  const [lower, upper] = domain ?? automaticDomain(definition, values);
  if (definition.kind === "discrete") {
    const start = Math.ceil(lower);
    const end = Math.floor(upper);
    const x = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
    return { x, density: x.map((value) => safeDensity(definition, value, values)), cdf: x.map((value) => safeCdf(definition, value, values)) };
  }

  const span = upper - lower;
  const support = definition.support(values);
  const step = span / Math.max(1, points - 1);
  const x = Array.from({ length: points }, (_, index) => {
    let value = lower + step * index;
    if (index === 0 && Number.isFinite(support.lower)) value = Math.min(upper, value + Math.max(step * 0.015, span * 1e-8));
    if (index === points - 1 && Number.isFinite(support.upper)) value = Math.max(lower, value - Math.max(step * 0.015, span * 1e-8));
    return value;
  });
  const rawDensity = x.map((value) => safeDensity(definition, value, values));
  const finiteDensity = rawDensity.filter(Number.isFinite);
  const cap = percentile(finiteDensity, 0.995) * 1.35;
  const density = rawDensity.map((value) => (Number.isFinite(value) ? Math.min(value, cap || value) : cap || Number.NaN));
  return { x, density, cdf: x.map((value) => safeCdf(definition, value, values)) };
};

export const supportLabel = (definition: DistributionDefinition, values: ParameterValues) => {
  const support = definition.support(values);
  const lower = support.lower === Number.NEGATIVE_INFINITY ? "−∞" : formatCompact(support.lower);
  const upper = support.upper === Number.POSITIVE_INFINITY ? "∞" : formatCompact(support.upper);
  const left = support.lowerClosed === false ? "(" : "[";
  const right = support.upperClosed === false ? ")" : "]";
  return `${left}${lower}, ${upper}${right}${definition.kind === "discrete" ? " ∩ ℤ" : ""}`;
};

export const formatCompact = (value: number) => {
  if (Number.isNaN(value)) return "undefined";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  const abs = Math.abs(value);
  if ((abs > 0 && abs < 0.001) || abs >= 10000) return value.toExponential(3);
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 4 }).format(value);
};

function formatTailExponent(value: number) {
  return value < 0 ? `−${formatCompact(Math.abs(value))}` : formatCompact(value);
}

function percentile(values: number[], probability: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(probability * (sorted.length - 1))))];
}
