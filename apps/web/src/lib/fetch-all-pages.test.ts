import { describe, expect, it, vi } from "vitest";

import { fetchAllPages } from "@/lib/fetch-all-pages";

/** A table of `count` rows the API hands back a range at a time, as `.range(from, to)` does (both ends in). */
function tableOf(count: number, failAt: number | null = null) {
  const rows = Array.from({ length: count }, (_, index) => index + 1);
  return vi.fn(async (from: number, to: number) =>
    failAt !== null && from >= failAt
      ? { data: null, error: { message: "falhou" } }
      : { data: rows.slice(from, to + 1), error: null },
  );
}

describe("every row of a list, read in the pages the API hands back", () => {
  it("reads past the first page until a page comes short", async () => {
    const page = tableOf(5);
    expect(await fetchAllPages(page, 2)).toEqual({ data: [1, 2, 3, 4, 5], error: null });
    expect(page.mock.calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("asks once more when the last page came full, and stops at the empty one", async () => {
    const page = tableOf(4);
    expect(await fetchAllPages(page, 2)).toEqual({ data: [1, 2, 3, 4], error: null });
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("stops at the first error, saying it, with what it had read", async () => {
    expect(await fetchAllPages(tableOf(5, 2), 2)).toEqual({ data: [1, 2], error: "falhou" });
  });
});
