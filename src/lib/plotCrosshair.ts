/** A pointer overlay independent of Plotly's throttled, nearest-data-point hover. */
export function createPlotCrosshair(graph: HTMLElement) {
  const overlay = document.createElement("div");
  overlay.className = "chart-crosshair";
  overlay.setAttribute("aria-hidden", "true");
  const vertical = document.createElement("div");
  vertical.className = "crosshair-vertical";
  const horizontal = document.createElement("div");
  horizontal.className = "crosshair-horizontal";
  overlay.append(vertical, horizontal);

  let bounds: DOMRect | null = null;
  let pointer: { x: number; y: number } | null = null;
  let dragging = false;
  let geometryDirty = true;
  let frame: number | null = null;
  let disposed = false;

  function contains(x: number, y: number) {
    return !!bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  function measure() {
    geometryDirty = false;
    const area = graph.querySelector(".nsewdrag");
    const paper = graph.querySelector<HTMLElement>(".svg-container");
    const hoverPaper = graph.querySelector<SVGGElement>(".hoverlayer")?.ownerSVGElement;
    if (!area || !paper || !hoverPaper) {
      bounds = null; // A 3D scene has its own pointer and camera interaction.
      overlay.remove();
      return;
    }
    bounds = area.getBoundingClientRect();
    const origin = paper.getBoundingClientRect();
    // Keep lines above the chart and below Plotly's value tooltips.
    if (overlay.parentElement !== paper || overlay.nextElementSibling !== hoverPaper) paper.insertBefore(overlay, hoverPaper);
    overlay.style.left = `${bounds.left - origin.left}px`;
    overlay.style.top = `${bounds.top - origin.top}px`;
    overlay.style.width = `${bounds.width}px`;
    overlay.style.height = `${bounds.height}px`;
  }

  function paint() {
    frame = null;
    if (disposed) return;
    if (geometryDirty) measure();
    if (!pointer || !bounds || !contains(pointer.x, pointer.y)) {
      overlay.style.visibility = "hidden";
      return;
    }
    // No axis calculations, Plotly calls, React updates or layout reads on pointer movement.
    vertical.style.transform = `translate3d(${pointer.x - bounds.left}px, 0, 0)`;
    horizontal.style.transform = `translate3d(0, ${pointer.y - bounds.top}px, 0)`;
    overlay.style.visibility = "visible";
  }

  function schedule() {
    if (!disposed && frame === null) frame = requestAnimationFrame(paint);
  }

  function refresh() {
    geometryDirty = true;
    schedule();
  }

  function move(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }

  function enter(event: PointerEvent) {
    geometryDirty = true;
    move(event);
  }

  function leave() {
    if (dragging) return; // Plotly's drag cover temporarily sits above the graph.
    pointer = null;
    overlay.style.visibility = "hidden";
  }

  function down(event: PointerEvent) {
    if (event.pointerType === "touch" || event.button !== 0) return;
    if (geometryDirty) measure();
    if (!contains(event.clientX, event.clientY)) return;
    dragging = true;
    graph.classList.add("is-pointer-dragging");
    move(event);
  }

  function dragMove(event: PointerEvent) {
    if (dragging) move(event);
  }

  function up(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    graph.classList.remove("is-pointer-dragging");
    move(event);
  }

  function cancel() {
    dragging = false;
    graph.classList.remove("is-pointer-dragging");
    pointer = null;
    overlay.style.visibility = "hidden";
  }

  function primaryButtonOnly(event: MouseEvent) {
    if (bounds && event.button !== 0) event.stopPropagation();
  }

  graph.addEventListener("pointerenter", enter, { passive: true });
  graph.addEventListener("pointermove", move, { passive: true });
  graph.addEventListener("pointerleave", leave, { passive: true });
  graph.addEventListener("pointerdown", down, { passive: true });
  graph.addEventListener("mousedown", primaryButtonOnly, true);
  window.addEventListener("pointermove", dragMove, { capture: true, passive: true });
  window.addEventListener("pointerup", up, { capture: true, passive: true });
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("scroll", refresh, { capture: true, passive: true });
  window.addEventListener("resize", refresh, { passive: true });

  return {
    refresh,
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      graph.removeEventListener("pointerenter", enter);
      graph.removeEventListener("pointermove", move);
      graph.removeEventListener("pointerleave", leave);
      graph.removeEventListener("pointerdown", down);
      graph.removeEventListener("mousedown", primaryButtonOnly, true);
      window.removeEventListener("pointermove", dragMove, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      graph.classList.remove("is-pointer-dragging");
      overlay.remove();
    },
  };
}
