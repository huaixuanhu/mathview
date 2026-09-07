declare module "plotly.js/dist/plotly" {
  import * as Plotly from "plotly.js";
  const renderer: typeof Plotly & { Fx: { unhover: (graph: HTMLElement) => void } };
  export default renderer;
}
