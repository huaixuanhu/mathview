# MathView

MathView is a small, browser-based probability laboratory for statistics, data science, and financial mathematics. It runs entirely in the browser, works on desktop and mobile, and does not require MATLAB or a backend service.

## Version 0.1 scope

- Interactive PDF/PMF and CDF plots with editable parameters
- One-dimensional interval probabilities and pinned curve comparisons
- Two-dimensional independent joint distributions as heatmaps, contours, or 3D surfaces
- Upper- and lower-tail VaR and ES views
- Log-log survival plots and regular-variation reference slopes where applicable
- CSV data export and Plotly PNG chart export
- Responsive layout and local persistence of the current workspace

The two-dimensional mode currently uses

```text
f(x, y) = f_X(x) f_Y(y)
F(x, y) = F_X(x) F_Y(y)
```

so `X` and `Y` are independent and use the same distribution family with separately editable parameters.

## Included distributions

| Family | Distributions |
| --- | --- |
| Foundations | Normal, Student's t, Chi-square, F, Uniform |
| Positive and shape models | Lognormal, Gamma, Beta, Weibull, Inverse Gamma, Power function, Triangular |
| Waiting-time models | Exponential, Geometric |
| Count models | Bernoulli, Poisson, Binomial, Negative Binomial, Hypergeometric |
| Heavy-tail and extreme-value models | Pareto I, Cauchy, Laplace, Logistic, GEV, GPD |

The Negative Binomial convention is explicit: `r` is the required number of successes, `p` is the probability of success on each trial, and the random variable counts failures before the `r`-th success.

The Power function distribution is a bounded distribution on `[0, b]`; it is distinct from a power-law tail.

## Numerical conventions

- VaR is the distribution quantile at the selected confidence level.
- ES follows the quantile-integral definition. Closed-form formulas are used where implemented; other continuous cases use deterministic numerical integration, and discrete cases allocate boundary mass at VaR.
- ES is reported as divergent when the relevant first tail moment does not exist.
- Regular variation is shown for distributions whose survival tail is regularly varying under the current parameters. The chart displays the actual survival probability together with an asymptotic reference slope.

## Local development

### Source map

- `src/App.tsx`: view state, controls, Plotly charts, browser persistence, exports, and the optional `show_probability_distribution` WebMCP tool.
- `src/lib/distributions.ts`: distribution definitions, parameter validation, sampling, and tail properties.
- `src/lib/risk.ts`: interval probabilities, VaR, ES, and survival-tail calculations.
- `src/lib/distributions.test.ts` and `tests/fixtures/scipy_reference.json`: numerical checks and the SciPy reference data.
- `scripts/generate_scipy_reference.py`: reference-data generation using the project Python environment.

### Run locally

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Validation

```bash
npm test
npm run build
```

The distribution tests compare PDF/PMF, CDF, and quantile values with a checked-in reference fixture generated from SciPy. To regenerate it using the project Python virtual environment:

```bash
.venv/bin/python scripts/generate_scipy_reference.py
```

## Deployment

The repository includes `vercel.json` for a Vite production build. Vercel builds with `npm run build` and publishes the `dist` directory.

## Human-AI collaboration

Project rules are maintained in [AGENTS.md](AGENTS.md), adapted from human-ai-governance v0.7.7. They retain valid task authorization, preserve the active objective across side questions, and require evidence for completed or cancelled operations. See the [adoption record](docs/human-ai-governance-v0.7.7.md) for the local source version and validation.

The rules use the existing project commands above. Changes to the global skill require a separately requested project update; committing or pushing project work does not by itself authorize deployment or domain changes.

## Future direction

Future versions can add general multivariate function surfaces, including option-pricing, volatility, return, log-posterior-density, log-likelihood, and derivative visualizations. These can be implemented with browser numerical code plus Plotly/WebGL and do not inherently require MATLAB.
