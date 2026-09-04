import { describe, expect, it } from "vitest";
import reference from "../../tests/fixtures/scipy_reference.json";
import {
  automaticDomain,
  defaultParameters,
  distributionById,
  distributions,
  safeCdf,
  safeDensity,
  sampleDistribution,
  validateParameters,
} from "./distributions";
import type { ParameterValues } from "./distributions";
import { calculateRisk, intervalProbability, tailSeries } from "./risk";

function expectNumericallyClose(actual: number, expected: number, relativeTolerance = 2e-6, absoluteTolerance = 2e-8) {
  const allowed = Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance);
  expect(Math.abs(actual - expected), `actual=${actual}, expected=${expected}, allowed=${allowed}`).toBeLessThanOrEqual(allowed);
}

describe("distribution registry", () => {
  it("contains 25 uniquely named, valid distributions", () => {
    expect(distributions).toHaveLength(25);
    expect(new Set(distributions.map((item) => item.id)).size).toBe(distributions.length);
    for (const definition of distributions) {
      expect(validateParameters(definition, defaultParameters(definition)), definition.id).toEqual([]);
    }
  });

  it("matches SciPy reference PDF/PMF, CDF and quantiles", () => {
    expect(reference.scipy_version).toBe("1.18.1");
    for (const testCase of reference.cases) {
      const definition = distributionById(testCase.id);
      const parameters = testCase.parameters as unknown as ParameterValues;
      const density = safeDensity(definition, testCase.x, parameters);
      const cdf = safeCdf(definition, testCase.x, parameters);
      const quantile = definition.quantile(testCase.q, parameters);
      expectNumericallyClose(density, testCase.density, 1e-5, 2e-8);
      expectNumericallyClose(cdf, testCase.cdf, 1e-5, 2e-8);
      if (definition.kind === "discrete") expect(quantile, definition.id).toBe(testCase.quantile);
      else expectNumericallyClose(quantile, testCase.quantile, 2e-5, 2e-7);
    }
  });

  it("generates monotone CDF samples and non-negative densities", () => {
    for (const definition of distributions) {
      const parameters = defaultParameters(definition);
      const domain = automaticDomain(definition, parameters);
      const sample = sampleDistribution(definition, parameters, domain, 240);
      expect(sample.x.length, definition.id).toBeGreaterThan(1);
      for (const value of sample.density) {
        expect(value, definition.id).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(value), definition.id).toBe(true);
      }
      for (let index = 1; index < sample.cdf.length; index += 1) {
        expect(sample.cdf[index] + 1e-11, definition.id).toBeGreaterThanOrEqual(sample.cdf[index - 1]);
      }
    }
  });

  it("uses the requested Negative Binomial convention", () => {
    const definition = distributionById("negative-binomial");
    const parameters = { r: 5, prob: 0.45 };
    expectNumericallyClose(definition.density(0, parameters), parameters.prob ** parameters.r, 1e-12, 1e-12);
    expectNumericallyClose(definition.mean(parameters), (parameters.r * (1 - parameters.prob)) / parameters.prob, 1e-12, 1e-12);
  });
});

describe("probability and tail analytics", () => {
  it("computes the Normal central interval", () => {
    const definition = distributionById("normal");
    expectNumericallyClose(intervalProbability(definition, { mu: 0, sigma: 1 }, -1, 1), 0.682689492137, 2e-6, 1e-8);
  });

  it("computes closed-form Normal and Pareto upper-tail risk", () => {
    const normal = calculateRisk(distributionById("normal"), { mu: 0, sigma: 1 }, 0.95, "upper");
    expectNumericallyClose(normal.valueAtRisk, 1.644853626951, 2e-6, 1e-8);
    expectNumericallyClose(normal.expectedShortfall, 2.062712807507, 2e-6, 1e-8);

    const pareto = calculateRisk(distributionById("pareto"), { scale: 1, shape: 2.5 }, 0.95, "upper");
    expectNumericallyClose(pareto.expectedShortfall, (2.5 * pareto.valueAtRisk) / 1.5, 1e-12, 1e-12);
  });

  it("reports divergent ES when the first tail moment does not exist", () => {
    const cauchy = calculateRisk(distributionById("cauchy"), { location: 0, scale: 1 }, 0.95, "upper");
    expect(cauchy.expectedShortfall).toBe(Number.POSITIVE_INFINITY);

    const pareto = calculateRisk(distributionById("pareto"), { scale: 1, shape: 0.9 }, 0.95, "upper");
    expect(pareto.expectedShortfall).toBe(Number.POSITIVE_INFINITY);
  });

  it("builds a regular-variation reference slope for Pareto", () => {
    const definition = distributionById("pareto");
    const series = tailSeries(definition, { scale: 1, shape: 2.5 });
    expect(series.x.length).toBeGreaterThan(100);
    expect(series.reference).toHaveLength(series.x.length);
    expect(definition.tail({ scale: 1, shape: 2.5 }).exponent).toBe(-2.5);
  });
});
