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
