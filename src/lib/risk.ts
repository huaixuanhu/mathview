import type { DistributionDefinition, ParameterValues } from "./distributions";
import { safeCdf, safeDensity, survival } from "./distributions";

export type TailDirection = "upper" | "lower";

export interface RiskResult {
  valueAtRisk: number;
  expectedShortfall: number;
  confidence: number;
  tailProbability: number;
  direction: TailDirection;
  approximate: boolean;
  note: string;
}

const clampConfidence = (confidence: number) => Math.min(0.999, Math.max(0.8, confidence));

export function calculateRisk(
  definition: DistributionDefinition,
  parameters: ParameterValues,
  confidenceInput: number,
  direction: TailDirection,
): RiskResult {
  const confidence = clampConfidence(confidenceInput);
  const tailProbability = 1 - confidence;
  const probability = direction === "upper" ? confidence : tailProbability;
  const valueAtRisk = definition.quantile(probability, parameters);

  if (!tailMeanExists(definition, parameters, direction)) {
    return {
      valueAtRisk,
      expectedShortfall: direction === "upper" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      confidence,
      tailProbability,
      direction,
      approximate: false,
      note: "Expected Shortfall diverges for this parameter choice.",
    };
  }

  if (definition.kind === "discrete") {
    return {
      valueAtRisk,
      expectedShortfall: discreteExpectedShortfall(definition, parameters, confidence, direction, valueAtRisk),
      confidence,
      tailProbability,
      direction,
      approximate: false,
      note: "Discrete ES uses the quantile-integral definition and allocates boundary mass at VaR.",
    };
  }

  const analytic = analyticExpectedShortfall(definition, parameters, confidence, direction, valueAtRisk);
  if (analytic !== undefined) {
    return {
      valueAtRisk,
      expectedShortfall: analytic,
      confidence,
      tailProbability,
      direction,
      approximate: false,
      note: "Closed-form tail expectation for this distribution.",
    };
  }

  return {
    valueAtRisk,
    expectedShortfall: quantileExpectedShortfall(definition, parameters, confidence, direction),
    confidence,
    tailProbability,
    direction,
    approximate: true,
    note: "ES is evaluated by deterministic numerical integration of the quantile function.",
  };
}

function analyticExpectedShortfall(
  definition: DistributionDefinition,
  p: ParameterValues,
  confidence: number,
  direction: TailDirection,
  valueAtRisk: number,
) {
  const alpha = 1 - confidence;
  if (definition.id === "normal") {
    const z = (valueAtRisk - p.mu) / p.sigma;
    const phi = Math.exp(-(z ** 2) / 2) / Math.sqrt(2 * Math.PI);
    return direction === "upper" ? p.mu + (p.sigma * phi) / alpha : p.mu - (p.sigma * phi) / alpha;
  }

  if (definition.id === "student-t") {
    const z = (valueAtRisk - p.mu) / p.scale;
    const standardizedDensity = definition.density(valueAtRisk, p) * p.scale;
    const adjustment = ((p.nu + z ** 2) / (p.nu - 1)) * (standardizedDensity / alpha);
    return direction === "upper" ? p.mu + p.scale * adjustment : p.mu - p.scale * adjustment;
  }

  if (direction === "upper" && definition.id === "exponential") return valueAtRisk + 1 / p.rate;
  if (direction === "upper" && definition.id === "pareto") return (p.shape * valueAtRisk) / (p.shape - 1);
  if (direction === "upper" && definition.id === "gpd") {
    const meanExcess = (p.scale + p.shape * (valueAtRisk - p.location)) / (1 - p.shape);
    return valueAtRisk + meanExcess;
  }
  return undefined;
}

function tailMeanExists(definition: DistributionDefinition, p: ParameterValues, direction: TailDirection) {
  if (direction === "lower") return !(["student-t", "cauchy"].includes(definition.id) && (definition.id === "cauchy" || p.nu <= 1));
  switch (definition.id) {
    case "student-t": return p.nu > 1;
    case "cauchy": return false;
    case "f": return p.df2 > 2;
    case "pareto": return p.shape > 1;
    case "inverse-gamma": return p.shape > 1;
    case "gev": return p.shape < 1;
    case "gpd": return p.shape < 1;
    default: return true;
  }
}

function quantileExpectedShortfall(
  definition: DistributionDefinition,
  p: ParameterValues,
  confidence: number,
  direction: TailDirection,
) {
  const alpha = 1 - confidence;
  const intervals = 720;
  const maxT = 24;
  const h = maxT / intervals;

  const integrand = (t: number) => {
    const weight = Math.exp(-t);
    const probability = direction === "upper" ? 1 - alpha * weight : alpha * weight;
    const quantile = definition.quantile(Math.min(1 - 1e-12, Math.max(1e-12, probability)), p);
    return quantile * weight;
  };

  let sum = integrand(0) + integrand(maxT);
  for (let index = 1; index < intervals; index += 1) sum += (index % 2 === 0 ? 2 : 4) * integrand(index * h);
  return (h / 3) * sum;
}

function discreteExpectedShortfall(
  definition: DistributionDefinition,
  p: ParameterValues,
  confidence: number,
  direction: TailDirection,
  valueAtRisk: number,
) {
  const alpha = 1 - confidence;
  const support = definition.support(p);
  const lower = Number.isFinite(support.lower) ? Math.ceil(support.lower) : definition.quantile(1e-10, p);
  const upper = Number.isFinite(support.upper) ? Math.floor(support.upper) : definition.quantile(1 - 1e-10, p);
  let strictProbability = 0;
  let strictMoment = 0;

  for (let x = lower; x <= upper; x += 1) {
    const mass = safeDensity(definition, x, p);
    const inStrictTail = direction === "upper" ? x > valueAtRisk : x < valueAtRisk;
    if (inStrictTail) {
      strictProbability += mass;
      strictMoment += x * mass;
    }
  }

  const boundaryAllocation = Math.max(0, alpha - strictProbability);
  return (strictMoment + valueAtRisk * boundaryAllocation) / alpha;
}

export function intervalProbability(
  definition: DistributionDefinition,
  p: ParameterValues,
  lower: number,
  upper: number,
) {
  if (!(upper >= lower)) return Number.NaN;
  if (definition.kind === "continuous") return Math.max(0, safeCdf(definition, upper, p) - safeCdf(definition, lower, p));
  const first = Math.ceil(lower);
  const last = Math.floor(upper);
  if (last < first) return 0;
  return Math.max(0, safeCdf(definition, last, p) - safeCdf(definition, first - 1, p));
}

export function tailSeries(definition: DistributionDefinition, p: ParameterValues, count = 150) {
  const logStart = Math.log(0.45);
  const logEnd = Math.log(1e-7);
  const points = Array.from({ length: count }, (_, index) => {
    const survivalProbability = Math.exp(logStart + ((logEnd - logStart) * index) / (count - 1));
    const x = definition.quantile(1 - survivalProbability, p);
    return { x, y: survival(definition, x, p) };
  }).filter((point) => Number.isFinite(point.x) && point.x > 0 && point.y > 0);

  const deduplicated = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x);
  const metadata = definition.tail(p);
  if (metadata.classification !== "regular" || metadata.exponent === undefined || deduplicated.length < 4) {
    return { x: deduplicated.map((point) => point.x), y: deduplicated.map((point) => point.y), reference: undefined };
  }

  const anchor = deduplicated[Math.floor(deduplicated.length * 0.62)];
  const reference = deduplicated.map((point) => anchor.y * (point.x / anchor.x) ** metadata.exponent!);
  return {
    x: deduplicated.map((point) => point.x),
    y: deduplicated.map((point) => point.y),
    reference,
  };
}
