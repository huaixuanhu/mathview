/** Coalesce at the next frame; while drawing, retain only the latest waiting input. */
export function createRenderQueue<T>(
  draw: (value: T) => Promise<unknown>,
  onError: (error: unknown) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
) {
  let pending: { value: T } | null = null;
  let frame: number | null = null;
  let active: Promise<void> | null = null;
  let disposed = false;

  function flush() {
    frame = null;
    if (disposed || !pending) return;
    const { value } = pending;
    pending = null;
    active = Promise.resolve().then(() => draw(value)).then(() => undefined).catch(onError).finally(() => {
      active = null;
      // An asynchronous draw may already have crossed a frame boundary. Catch up
      // immediately with the newest input instead of adding another idle frame.
      if (!disposed && pending) flush();
    });
  }

  function pump() {
    if (disposed || active || frame !== null || !pending) return;
    frame = schedule(flush);
  }

  return {
    request(value: T) {
      if (disposed) return;
      pending = { value };
      pump();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (frame !== null) cancel(frame);
      frame = null;
      return active ?? Promise.resolve();
    },
  };
}
