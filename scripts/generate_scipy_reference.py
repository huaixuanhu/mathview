"""Generate deterministic SciPy reference values for MathView's distribution registry."""

from __future__ import annotations

import json
import math
from pathlib import Path

import scipy
from scipy import stats


def continuous_case(identifier, distribution, x, q, parameters):
    return {
        "id": identifier,
        "parameters": parameters,
        "x": x,
        "q": q,
        "density": float(distribution.pdf(x)),
        "cdf": float(distribution.cdf(x)),
        "quantile": float(distribution.ppf(q)),
    }


def discrete_case(identifier, distribution, x, q, parameters, x_offset=0):
    return {
        "id": identifier,
        "parameters": parameters,
        "x": x,
        "q": q,
        "density": float(distribution.pmf(x + x_offset)),
        "cdf": float(distribution.cdf(x + x_offset)),
        "quantile": float(distribution.ppf(q) - x_offset),
    }


def build_cases():
    cases = [
        continuous_case("normal", stats.norm(loc=0.4, scale=1.3), 0.7, 0.8, {"mu": 0.4, "sigma": 1.3}),
        continuous_case("lognormal", stats.lognorm(s=0.6, scale=math.exp(0.2)), 1.4, 0.8, {"mu": 0.2, "sigma": 0.6}),
        continuous_case("gamma", stats.gamma(a=2.4, scale=1.2), 2.3, 0.8, {"shape": 2.4, "scale": 1.2}),
        continuous_case("beta", stats.beta(a=2.3, b=4.2), 0.4, 0.8, {"alpha": 2.3, "beta": 4.2}),
        continuous_case("exponential", stats.expon(scale=1 / 1.4), 0.8, 0.8, {"rate": 1.4}),
        continuous_case("student-t", stats.t(df=5.5, loc=0.3, scale=1.2), 0.7, 0.8, {"nu": 5.5, "mu": 0.3, "scale": 1.2}),
        continuous_case("chi-square", stats.chi2(df=6.2), 3.2, 0.8, {"nu": 6.2}),
        continuous_case("weibull", stats.weibull_min(c=1.7, scale=1.4), 1.1, 0.8, {"shape": 1.7, "scale": 1.4}),
        continuous_case("f", stats.f(dfn=5.5, dfd=11.0), 1.3, 0.8, {"df1": 5.5, "df2": 11.0}),
        continuous_case("pareto", stats.pareto(b=2.8, scale=1.2), 2.0, 0.8, {"scale": 1.2, "shape": 2.8}),
        continuous_case("power-function", stats.powerlaw(a=2.2, scale=1.5), 0.9, 0.8, {"shape": 2.2, "upper": 1.5}),
        discrete_case("poisson", stats.poisson(mu=4.3), 3, 0.8, {"rate": 4.3}),
        discrete_case("binomial", stats.binom(n=20, p=0.4), 7, 0.8, {"n": 20, "prob": 0.4}),
        discrete_case("negative-binomial", stats.nbinom(n=5, p=0.45), 4, 0.8, {"r": 5, "prob": 0.45}),
        discrete_case("hypergeometric", stats.hypergeom(M=50, n=18, N=12), 4, 0.8, {"population": 50, "successes": 18, "draws": 12}),
        continuous_case("uniform", stats.uniform(loc=-1.0, scale=3.0), 0.4, 0.8, {"lower": -1.0, "upper": 2.0}),
        discrete_case("bernoulli", stats.bernoulli(p=0.4), 0, 0.8, {"prob": 0.4}),
        discrete_case("geometric", stats.geom(p=0.35), 2, 0.8, {"prob": 0.35}, x_offset=1),
        continuous_case("cauchy", stats.cauchy(loc=0.2, scale=1.1), 0.7, 0.8, {"location": 0.2, "scale": 1.1}),
        continuous_case("laplace", stats.laplace(loc=0.2, scale=1.1), 0.7, 0.8, {"location": 0.2, "scale": 1.1}),
        continuous_case("logistic", stats.logistic(loc=0.2, scale=1.1), 0.7, 0.8, {"location": 0.2, "scale": 1.1}),
        continuous_case("inverse-gamma", stats.invgamma(a=3.5, scale=2.0), 0.9, 0.8, {"shape": 3.5, "scale": 2.0}),
        continuous_case("triangular", stats.triang(c=0.4, loc=0.0, scale=1.0), 0.35, 0.8, {"lower": 0.0, "mode": 0.4, "upper": 1.0}),
        # SciPy's genextreme shape c uses the opposite sign to the conventional GEV xi.
        continuous_case("gev", stats.genextreme(c=-0.15, loc=0.2, scale=1.1), 0.7, 0.8, {"location": 0.2, "scale": 1.1, "shape": 0.15}),
        continuous_case("gpd", stats.genpareto(c=0.25, loc=0.1, scale=1.2), 1.0, 0.8, {"location": 0.1, "scale": 1.2, "shape": 0.25}),
    ]
    return {"scipy_version": scipy.__version__, "cases": cases}


if __name__ == "__main__":
    output_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "scipy_reference.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(build_cases(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(output_path)
