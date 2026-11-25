import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCREEN_CHANGED, useLiveRead } from "@/components/product/use-live-read";
import { PULSE_BUSY_MS, PULSE_HOT_MS, PULSE_IDLE_MS } from "@/lib/cases/pulse";
import { act, cleanup, renderHook } from "@testing-library/react";

// A screen that follows the database by its mark (the audit of the case's sync, 2026-11-25): how often it asks, that
// it never reads itself twice at once, and what it tells the rest of the page.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-25T14:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets the timers run and what they started settle. */
const pass = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function mount(start: { stamp: string | null; busy?: boolean; database: string | null }) {
  const world = { database: start.database };
  const read = vi.fn(async () => world.database);
  const gate: { land: () => void } = { land: () => {} };
  const onChange = vi.fn(() => new Promise<void>((resolve) => (gate.land = resolve)));
  const hook = renderHook(
    (props: { stamp: string | null; busy: boolean }) => useLiveRead({ ...props, read, onChange }),
    { initialProps: { stamp: start.stamp, busy: start.busy ?? false } },
  );
  return { ...hook, world, read, onChange, land: () => gate.land() };
}

describe("a screen that follows the database", () => {
  it("asks at the quiet pace, and often right after the person acted", async () => {
    const screen = mount({ stamp: "s1", database: "s1" });
    await pass(PULSE_IDLE_MS - 1);
    expect(screen.read).not.toHaveBeenCalled();
    await pass(1);
    expect(screen.read).toHaveBeenCalledTimes(1);

    act(() => screen.result.current.acted());
    await pass(PULSE_HOT_MS);
    expect(screen.read).toHaveBeenCalledTimes(2);
    await pass(PULSE_HOT_MS);
    expect(screen.read).toHaveBeenCalledTimes(3);
  });

  it("asks every two seconds while ONE works on what it shows", async () => {
    const screen = mount({ stamp: "s1", busy: true, database: "s1" });
    await pass(PULSE_BUSY_MS);
    expect(screen.read).toHaveBeenCalledTimes(1);
    await pass(PULSE_BUSY_MS);
    expect(screen.read).toHaveBeenCalledTimes(2);
  });

  it("reads itself again when the mark moved, and asks nothing more until that reading landed", async () => {
    const screen = mount({ stamp: "s1", busy: true, database: "s2" });
    await pass(PULSE_BUSY_MS);
    expect(screen.onChange).toHaveBeenCalledTimes(1);
    // The reading is on its way: the mark moves on, and the screen still asks nothing on top of it.
    screen.world.database = "s3";
    await pass(PULSE_BUSY_MS * 3);
    expect(screen.read).toHaveBeenCalledTimes(1);
    expect(screen.onChange).toHaveBeenCalledTimes(1);

    // It landed, drawn with the mark it was asked for: the next question finds the newer one.
    screen.land();
    screen.rerender({ stamp: "s2", busy: true });
    await pass(PULSE_BUSY_MS);
    expect(screen.read).toHaveBeenCalledTimes(2);
    expect(screen.onChange).toHaveBeenCalledTimes(2);
  });

  it("asks again for a change whose reading read nothing, never sets it aside as asked", async () => {
    const world = { database: "s2" };
    const read = vi.fn(async () => world.database);
    // The screen was busy bringing itself up another way: it read nothing, and says so.
    const onChange = vi.fn(async () => false);
    renderHook(() => useLiveRead({ stamp: "s1", busy: true, read, onChange }));
    await pass(PULSE_BUSY_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    await pass(PULSE_BUSY_MS);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("says whether what it shows is what the database has", async () => {
    const screen = mount({ stamp: "s1", database: "s2" });
    let latest: string | null = null;
    await act(async () => {
      latest = await screen.result.current.latest();
    });
    expect(latest).toBe("s2");
    expect(screen.result.current.shows("s2")).toBe(false);
    screen.rerender({ stamp: "s2", busy: false });
    expect(screen.result.current.shows("s2")).toBe(true);
  });

  it("answers a mark it could not read as unknown, never as the screen's", async () => {
    const screen = mount({ stamp: "s1", database: null });
    let latest: string | null = "x";
    await act(async () => {
      latest = await screen.result.current.latest();
    });
    expect(latest).toBeNull();
  });

  it("tells the page when it shows something new, never when it is first drawn", () => {
    const heard = vi.fn();
    window.addEventListener(SCREEN_CHANGED, heard);
    const screen = mount({ stamp: "s1", database: "s1" });
    expect(heard).not.toHaveBeenCalled();
    screen.rerender({ stamp: "s2", busy: false });
    expect(heard).toHaveBeenCalledTimes(1);
    screen.rerender({ stamp: "s2", busy: true });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SCREEN_CHANGED, heard);
  });
});
