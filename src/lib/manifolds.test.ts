import { describe, expect, it } from "vitest";
import { callDifferential, callPrice, dot3, localComparison, manifoldExamples, pair, portfolioCovariance, portfolioVariance, safeStep, simplexBasis, simplexWeights, tangentVector, type Vec2 } from "./manifolds";

const exampleById = (id: string) => manifoldExamples.find((example) => example.id === id)!;

describe.each(manifoldExamples)("$id local geometry", (example) => {
  it("matches independent central differences for the surface and scalar at interior and boundary points", () => {
    const samples: Vec2[] = [example.initial, ...[0, 0.2, 0.65, 1].map((fraction) => example.coordinates.map((c) => c.range[0] + fraction * (c.range[1] - c.range[0])) as Vec2)];
    for (const q of samples) {
      const basis = example.basis(q);
      const alpha = example.differential(q);
      for (let i = 0; i < 2; i++) {
        const h = 1e-5;
        const left = [...q] as Vec2;
        const right = [...q] as Vec2;
        left[i] -= h;
        right[i] += h;
        const a = example.embed(left);
        const b = example.embed(right);
        for (let j = 0; j < 3; j++) expect(basis[i][j]).toBeCloseTo((b[j] - a[j]) / (2 * h), 5);
        expect(alpha[i]).toBeCloseTo((example.scalar(right) - example.scalar(left)) / (2 * h), 5);
      }
      // Every displayed point is a regular 2D patch, including the limits of the controls.
      const [a, b] = basis;
      const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      expect(Math.hypot(...cross)).toBeGreaterThan(1e-5);
    }
  });

  it("pairs a covector with a velocity to give the directional derivative and converges at second order", () => {
    const q = example.initial;
    const vector = example.initialVector;
    const h = 1e-5;
    const left: Vec2 = [q[0] - h * vector[0], q[1] - h * vector[1]];
    const right: Vec2 = [q[0] + h * vector[0], q[1] + h * vector[1]];
    expect(pair(example.differential(q), vector)).toBeCloseTo((example.scalar(right) - example.scalar(left)) / (2 * h), 5);
    const coarse = localComparison(example, q, vector, 0.02);
    const fine = localComparison(example, q, vector, 0.01);
    expect(Math.abs(fine.error)).toBeLessThan(Math.abs(coarse.error) * 0.28);
    const stationary = localComparison(example, q, [0, 0], 0.3);
    for (const value of [stationary.rate, stationary.predicted, stationary.actual, stationary.error]) expect(value).toBeCloseTo(0, 14);
  });
});

describe("statistical and financial conventions", () => {
  it("preserves total probability and embeds the categorical Fisher metric on the radius-two sphere", () => {
    const example = exampleById("simplex");
    const q: Vec2 = [0.24, 0.63];
    const p = simplexWeights(q);
    const v: Vec2 = [0.3, -0.2];
    const position = example.embed(q);
    const velocity = tangentVector(example, q, v);
    const [du, dv] = simplexBasis(q);
    const dp = du.map((value, i) => value * v[0] + dv[i] * v[1]);
    expect(p.reduce((a, b) => a + b)).toBeCloseTo(1, 14);
    expect(dp.reduce((a, b) => a + b)).toBeCloseTo(0, 14);
    expect(dot3(position, position)).toBeCloseTo(4, 14);
    expect(dot3(position, velocity)).toBeCloseTo(0, 14);
    expect(dot3(velocity, velocity)).toBeCloseTo(dp.reduce((sum, value, i) => sum + value * value / p[i], 0), 14);
    expect(example.scalar([1 / 3, 0.5])).toBeCloseTo(Math.log(3), 14);
    expect(example.differential([1 / 3, 0.5])[0]).toBeCloseTo(0, 14);
  });

  it("matches SciPy reference call prices and Greeks in m=S/K and decimal volatility coordinates", () => {
    // Independently calculated with project .venv scipy.stats.norm on 2026-09-08.
    const references = [
      { q: [1, 0.25], price: 11.348476825143516, dm: 59.677178432052436, vega: 38.714691479254604 },
      { q: [0.8, 0.15], price: 0.6165399703799659, dm: 11.263686642672626, vega: 15.300109915082032 },
      { q: [1.2, 0.5], price: 34.7564461846144, dm: 75.00487327722871, vega: 38.12924390302242 },
    ];
    for (const reference of references) {
      const q = reference.q as Vec2;
      expect(callPrice(q)).toBeCloseTo(reference.price, 10);
      expect(callDifferential(q)[0]).toBeCloseTo(reference.dm, 10);
      expect(callDifferential(q)[1]).toBeCloseTo(reference.vega, 10);
    }
    expect(localComparison(exampleById("option"), [1, 0.25], [0, 0.01], 0.01).rate).toBeCloseTo(0.38714691479254604, 10);
  });

  it("uses a positive-definite synthetic covariance and includes all three asset weights", () => {
    const [a, b, c] = portfolioCovariance;
    expect(a[0]).toBeGreaterThan(0);
    expect(a[0] * b[1] - a[1] * b[0]).toBeGreaterThan(0);
    expect(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])).toBeGreaterThan(0);
    expect(portfolioVariance([1, 0.5])).toBeCloseTo(144, 10);
    expect(portfolioVariance([0, 1])).toBeCloseTo(400, 10);
    expect(portfolioVariance([0, 0])).toBeCloseTo(784, 10);
    const weights = [0.3, 0.315, 0.385];
    const direct = (weights[0] * 12) ** 2 + (weights[1] * 20) ** 2 + (weights[2] * 28) ** 2
      + 2 * weights[0] * weights[1] * 12 * 20 * 0.2 + 2 * weights[0] * weights[2] * 12 * 28 * 0.1 + 2 * weights[1] * weights[2] * 20 * 28 * 0.25;
    expect(portfolioVariance([0.3, 0.45])).toBeCloseTo(direct, 10);
  });
});

describe("physical interpretation and chart boundaries", () => {
  it("keeps a spherical velocity tangent and pairs dU with velocity to give gravitational potential power", () => {
    const example = exampleById("sphere");
    const q: Vec2 = [1.2, 0.8];
    const velocity = tangentVector(example, q, [0.5, 0.3]);
    expect(dot3(example.embed(q), velocity)).toBeCloseTo(0, 14);
    expect(pair(example.differential(q), [0.5, 0.3])).toBeCloseTo(9.81 * velocity[2], 12);
  });

  it("matches the energy of two unit masses on unit rods and wraps both pendulum angles", () => {
    const example = exampleById("pendulum");
    const q: Vec2 = [0.7, -1.4];
    const y1 = -Math.cos(q[0]);
    const y2 = y1 - Math.cos(q[1]);
    expect(example.scalar(q)).toBeCloseTo(9.81 * (y1 + y2 + 3), 12);
    for (const wrapped of [[q[0] + 2 * Math.PI, q[1]], [q[0], q[1] + 2 * Math.PI]] as Vec2[]) {
      example.embed(wrapped).forEach((value, i) => expect(value).toBeCloseTo(example.embed(q)[i], 12));
      expect(example.scalar(wrapped)).toBeCloseTo(example.scalar(q), 12);
    }
    expect(safeStep(example, [Math.PI, Math.PI], [1, 1], 0.8)).toBe(0.8);
  });

  it("shortens a finite path at a patch boundary while retaining the unrestricted tangent direction", () => {
    const example = exampleById("normal");
    const q: Vec2 = [1.45, 0.8];
    const comparison = localComparison(example, q, [0.5, 0.25], 0.8);
    expect(comparison.step).toBeCloseTo(0.1, 12);
    expect(comparison.next[0]).toBeCloseTo(1.5, 12);
    expect(safeStep(example, [1.5, 0.3], [1, -1], 0.8)).toBe(0);
    expect(safeStep(example, [1.5, 0.3], [-1, 1], 0.8)).toBe(0.8);
    expect(tangentVector(example, [1.5, 0.3], [1, -1])).toEqual([1, -1, 2.4]);
  });
});
