import { type TrailPage, trailPageOf, type TrailQuery, useTrailPages } from "./trail-pages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

afterEach(cleanup);

/** A trail of `total` events, each its position, searched by whether its text holds the search. */
function trailOf(total: number) {
  const events = Array.from({ length: total }, (_, index) => `evento-${index + 1}`);
  return vi.fn(async (query: TrailQuery): Promise<TrailPage<string> | { error: string }> => {
    const matching = events.filter((event) => query.search === "" || event.includes(query.search));
    const from = query.page * query.pageSize;
    return { total: matching.length, rows: matching.slice(from, from + query.pageSize) };
  });
}

describe("a trail of the platform read a page at a time (0291)", () => {
  it("reads its first page, and every later page reaches older events", async () => {
    const read = trailOf(60);
    const { result } = renderHook(() => useTrailPages(read));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.total).toBe(60);
    expect(result.current.rows[0]).toBe("evento-1");
    act(() => result.current.server.onPageChange(2, 25));
    await waitFor(() => expect(result.current.rows[0]).toBe("evento-51"));
    expect(result.current.query.page).toBe(2);
  });

  it("asks the database for the search, from its first page", async () => {
    const read = trailOf(60);
    const { result } = renderHook(() => useTrailPages(read));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.server.onPageChange(1, 25));
    await waitFor(() => expect(result.current.query.page).toBe(1));
    act(() => result.current.server.onSearchChange("evento-5"));
    await waitFor(() => expect(result.current.total).toBe(11));
    expect(read).toHaveBeenLastCalledWith({ page: 0, pageSize: 25, search: "evento-5" });
    expect(result.current.rows).toContain("evento-55");
  });

  it("a page past the end is its last page, never an empty table", async () => {
    const read = trailOf(30);
    const { result } = renderHook(() => useTrailPages(read));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.server.onPageChange(4, 25));
    await waitFor(() => expect(result.current.query.page).toBe(1));
    expect(result.current.rows).toEqual(["evento-26", "evento-27", "evento-28", "evento-29", "evento-30"]);
  });

  it("an answer to an older question is not the trail's", async () => {
    const gate: { release?: () => void } = {};
    const read = vi.fn(async (query: TrailQuery): Promise<TrailPage<string>> => {
      if (query.search === "lenta") {
        await new Promise<void>((resolve) => (gate.release = resolve));
        return { total: 1, rows: ["da busca antiga"] };
      }
      return { total: 1, rows: [query.search === "" ? "primeira" : "da busca nova"] };
    });
    const { result } = renderHook(() => useTrailPages(read));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.server.onSearchChange("lenta"));
    act(() => result.current.server.onSearchChange("nova"));
    await waitFor(() => expect(result.current.rows).toEqual(["da busca nova"]));
    await act(async () => gate.release?.());
    expect(result.current.rows).toEqual(["da busca nova"]);
  });

  it("a failed read says so, keeps the page on screen with its number, and is asked again", async () => {
    let fail = false;
    const read = vi.fn(
      async (query: TrailQuery): Promise<TrailPage<string> | { error: string }> =>
        fail ? { error: "falhou" } : { total: 60, rows: [`pagina-${query.page}`] },
    );
    const { result } = renderHook(() => useTrailPages(read));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    fail = true;
    act(() => result.current.server.onPageChange(1, 25));
    await waitFor(() => expect(result.current.error).toBe("falhou"));
    expect(result.current.rows).toEqual(["pagina-0"]);
    expect(result.current.query.page).toBe(0);
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toEqual(["pagina-1"]));
    expect(result.current.error).toBeNull();
  });

  it("reads the database's answer, and refuses one that is not a trail's", () => {
    expect(trailPageOf({ total: 2, rows: [{ id: "a" }, null, { id: "b" }] })).toEqual({
      total: 2,
      rows: [{ id: "a" }, { id: "b" }],
    });
    expect(trailPageOf(null)).toBeNull();
    expect(trailPageOf([])).toBeNull();
    expect(trailPageOf({ rows: [] })).toBeNull();
  });
});
