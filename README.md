# MathView

MathView is a small, browser-based probability and geometry laboratory for statistics, finance, and physics. It runs entirely in the browser, works on desktop and mobile, and does not require MATLAB or a backend service.

## Version 0.1 scope

- Interactive PDF/PMF and CDF plots with editable parameters
- One-dimensional interval probabilities and pinned curve comparisons
- Two-dimensional independent joint distributions as heatmaps, contours, or 3D surfaces
- Upper- and lower-tail VaR and ES views
- Log-log survival plots and regular-variation reference slopes where applicable
- CSV data export and Plotly PNG chart export
- Responsive layout and local persistence of the current workspace
- A third top-level Manifold page with statistics, finance, and physics examples, tangent planes, tangent vectors, and cotangent-coordinate diagrams

The top-level pages are **Probability distribution**, **Tail**, and **Manifold**. The existing **1D Distribution / 2D Joint** switch is inside the probability page's parameter panel (expand Parameters on mobile).

## Manifold explorer

Each example is a two-dimensional smooth coordinate patch rendered in three dimensions. Change the base point and tangent-vector components with sliders or numeric inputs, or drag the arrow in the tangent-coordinate diagram. Rotate and zoom the 3D surface, toggle the tangent plane and comparison path, reset the camera, or export the 3D chart as PNG. The dual diagram and numeric readouts remain available independently of the 3D renderer.

| Field | Example | Surface representation | Covector shown |
| --- | --- | --- | --- |
| Statistics | Normal family | `(μ, σ, μ² + σ²)`, `σ > 0` | `d E[X²]` |
| Statistics | Three-category probability simplex | `2(√p₁, √p₂, √p₃)` | Entropy differential `dH`, natural logarithms |
| Finance | European call price | `(m, σ, C/K)`, `m = S/K` | `dC = K·Delta dm + Vega dσ` |
| Finance | Three-asset portfolio variance | `(w₁, w₂, wᵀΣw)` | `d(wᵀΣw)` in the two free chart coordinates |
| Physics | Particle constrained to a sphere | Unit sphere, away from polar-coordinate singularities | Gravitational potential differential `dU` |
| Physics | Double-pendulum configuration | A torus of two periodic absolute angles, plus an actual-pendulum sketch | Potential differential `dU` |

For an embedding `Φ(q¹,q²)`, the tangent vector is `v¹∂₁Φ + v²∂₂Φ`. The finite plane patch drawn at `p = Φ(q)` is a translated view of the tangent space. The 3D arrow is scaled for visibility; its displayed multiplier is stated below the plot. The two smaller diagrams show coefficients in the coordinate and dual bases. Their axes do not assert that the embedded coordinate basis is orthonormal.

The cotangent space is the dual vector space, drawn separately. Its arrow represents the coefficients of `α = df`, not a surface normal or a metric-independent gradient vector. Pairing is `α(v) = α₁v¹ + α₂v²`. The page compares `ε α(v)` with `f(q + εv) − f(q)` and reports the signed difference. The requested step is shortened at the displayed patch boundary; the selected tangent vector is unchanged. Periodic angles can cross their seam. A zero vector or zero covector has an explicit zero marker.

Model conventions:

- The normal moment surface is a visual embedding of the family, not its Fisher–Rao geometry. The categorical square-root embedding of radius 2 does preserve the Fisher metric. Its chart uses `p = (u, (1−u)v, (1−u)(1−v))` and stays inside `pᵢ > 0`.
- The option example uses `K = 100`, `T = 1 year`, `r = 3%`, and no dividends. Volatility is a decimal; Vega is per unit volatility, so a one-percentage-point change is `0.01`. Height is `C/K`, while price and differential readouts use `C`.
- Portfolio inputs are synthetic: annual volatilities `12%, 20%, 28%` and correlations `0.20, 0.10, 0.25` for pairs `12, 13, 23`. Covariance is `[[144,48,33.6],[48,400,140],[33.6,140,784]]` in percentage-point-squared units. Nonnegative weights follow the same interior chart as the categorical example.
- The sphere uses `m = 1 kg`, `R = 1 m`, `g = 9.81 m/s²`, and `U = mgz`. The double pendulum has two unit point masses and two massless unit rods, with both angles measured from the downward vertical. Its potential above the lowest configuration is `19.62(1−cos θ₁) + 9.81(1−cos θ₂)` J. The torus is a configuration representation, not a physical trajectory or a kinetic-energy metric. Physics vectors use rad/s; the step uses seconds; `dU(v)` is power in W. Comparison paths hold the selected coordinate velocities fixed and do not solve the equations of motion.

Manifold settings are saved separately under `mathview-manifold-v1`, validated when read, and flushed on page exit. Existing probability and tail storage keys and parameter values are retained; `mathview-mode` also accepts `manifold`. **Reset current example** restores that example's parameters without clearing other saved examples. Browser storage is optional.

References: [Normal family (NIST)](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3661.htm), [Fisher geometry (Davis et al., section 3.1)](https://arxiv.org/html/2405.14664v4#S3.SS1), [Black–Scholes and Greeks (Columbia)](https://www.columbia.edu/~mh2078/FoundationsFE/BlackScholes.pdf), [portfolio variance (William Sharpe)](https://web.stanford.edu/~wfsharpe/mia/rr/mia_rr4.htm), [mechanics and configuration spaces (Trinity College)](https://www.maths.tcd.ie/~hamiltlu/mechanics/ch1.pdf), [double pendulum (UC Berkeley)](https://rotations.berkeley.edu/the-double-pendulum/), and [smooth manifolds (John M. Lee)](https://sites.math.washington.edu/~lee/Books/ISM/).

## Chart controls

- Move the pointer anywhere inside a flat chart to see a crosshair at the pointer position. It remains visible away from the curve; hovering a curve still shows its data values.
- Hold the left mouse button and drag to pan; use the wheel or trackpad scroll to zoom.
- Double-click the plot to restore both axes to their default scales for the current data.
- Double-click the horizontal or vertical axis to restore only that axis. In Manual range mode, horizontal reset restores the entered bounds.
- Parameter changes preserve a view that you have panned or zoomed. Switching distribution or PDF/PMF/CDF starts a fresh view.
- **Reset view** is a keyboard-accessible alternative; in 3D it restores the camera. **PNG** exports the chart and **CSV** exports the 1D samples.
- On narrow screens, expand **Parameters** to edit the controls; collapse it to return to the chart.

The interface uses a graphite palette with muted blue, stone and rose accents. Plot updates are coalesced at animation frames, with only the latest pending input retained while a draw is running. A completed draw catches up with that input without waiting an extra frame. Pinned samples and layouts are reused. Parameter persistence is debounced by 200 ms and flushed when leaving the page; existing storage keys and saved values remain compatible.

The crosshair uses a separate pointer-transparent overlay beneath the value tooltips. It updates CSS transforms at animation frames without redrawing the plot or waiting for Plotly's hover timer. Plot geometry is measured after layout changes, resize, scroll or pointer entry, not on every pointer movement. The 3D surface retains its camera interaction.

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

- `src/App.tsx`: view state, controls, chart data, browser persistence, CSV export, and the optional `show_probability_distribution` WebMCP tool.
- `src/components/InteractivePlot.tsx`: Plotly rendering, pointer interaction, independent axis reset, resize handling, and PNG export.
- `src/lib/plotCrosshair.ts`: pointer-following crosshair, plot-boundary handling, and drag cursor lifecycle.
- `src/lib/renderQueue.ts` and `src/lib/renderQueue.test.ts`: latest-input scheduling, recovery, and cleanup checks.
- `src/lib/distributions.ts`: distribution definitions, parameter validation, sampling, and tail properties.
- `src/lib/risk.ts`: interval probabilities, VaR, ES, and survival-tail calculations.
- `src/components/ManifoldPage.tsx` and `src/components/manifold.css`: field/example selection, interactive tangent and cotangent-coordinate diagrams, local persistence, and responsive manifold workspace.
- `src/lib/manifolds.ts`: six embeddings, analytic tangent bases and differentials, model conventions, and local comparisons.
- `src/lib/manifoldPlots.ts`: cached surface grids, tangent-plane patches, 3D vectors, comparison paths, and camera layouts.
- `src/lib/manifolds.test.ts`: independent derivative checks, geometric constraints, SciPy call-price/Greek references, energy conventions, and boundary behavior.
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

Future versions can extend the manifold examples with additional metrics, model parameters, geodesics, and physical dynamics, and add general multivariate surfaces such as volatility, return, log-posterior-density, and log-likelihood. These can be implemented with browser numerical code plus Plotly/WebGL and do not inherently require MATLAB.
