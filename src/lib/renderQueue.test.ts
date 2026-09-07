import { describe, expect, it, vi } from "vitest";
import { createRenderQueue } from "./renderQueue";

function frameClock() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    schedule: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; },
    cancel: (key: number) => { callbacks.delete(key); },
    tick: () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach((callback) => callback(0)); },
  };
}

async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("chart rendering under rapid input", () => {
  it("draws the latest input in a frame and always delivers the final input", async () => {
    const clock = frameClock();
    const draw = vi.fn(async (_value: number) => undefined);
    const queue = createRenderQueue(draw, vi.fn(), clock.schedule, clock.cancel);
    for (let i = 0; i < 100; i++) queue.request(i);
    clock.tick();
    await settle();
    expect(draw.mock.calls.map(([value]) => value)).toEqual([99]);
    queue.request(100);
    clock.tick();
    await settle();
    expect(draw.mock.calls.map(([value]) => value)).toEqual([99, 100]);
    await queue.dispose();
  });

  it("does not overlap a slow draw or replay obsolete input afterward", async () => {
    const clock = frameClock();
    let finish!: () => void;
    const draw = vi.fn((value: number) => value === 1 ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
    const queue = createRenderQueue(draw, vi.fn(), clock.schedule, clock.cancel);
    queue.request(1);
    clock.tick();
    await settle();
    queue.request(2);
    queue.request(3);
    clock.tick();
    expect(draw.mock.calls.map(([value]) => value)).toEqual([1]);
    finish();
    await settle();
    expect(draw.mock.calls.map(([value]) => value)).toEqual([1, 3]);
    await queue.dispose();
  });

  it("reports a failed draw and recovers on the next input", async () => {
    const clock = frameClock();
    const problem = new Error("draw failed");
    const onError = vi.fn();
    const draw = vi.fn().mockRejectedValueOnce(problem).mockResolvedValue(undefined);
    const queue = createRenderQueue(draw, onError, clock.schedule, clock.cancel);
    queue.request(1);
    clock.tick();
    await settle();
    queue.request(2);
    clock.tick();
    await settle();
    expect(onError).toHaveBeenCalledWith(problem);
    expect(draw.mock.calls.map(([value]) => value)).toEqual([1, 2]);
    await queue.dispose();
  });

  it("waits for an active draw before cleanup and discards queued work", async () => {
    const clock = frameClock();
    let finish!: () => void;
    const draw = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const queue = createRenderQueue(draw, vi.fn(), clock.schedule, clock.cancel);
    queue.request(1);
    clock.tick();
    await settle();
    queue.request(2);
    const cleanup = vi.fn();
    const disposed = queue.dispose().then(cleanup);
    await settle();
    expect(cleanup).not.toHaveBeenCalled();
    finish();
    await disposed;
    queue.request(3);
    clock.tick();
    await settle();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
