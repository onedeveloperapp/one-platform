import ListMore, { useListPart } from "./list-more";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

const ITEMS = ["a", "b", "c", "d", "e"];

function Harness({ items, listKey }: { items: string[]; listKey: string }) {
  const listed = useListPart(items, 2, listKey);
  return (
    <>
      <ul>
        {listed.part.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <ListMore shown={listed.part.length} total={listed.total} step={2} onMore={listed.more} />
    </>
  );
}

const draw = (items: string[], listKey: string) => (
  <NextIntlClientProvider locale="pt-BR" messages={messages}>
    <Harness items={items} listKey={listKey} />
  </NextIntlClientProvider>
);

describe("a list read whole, drawn a part at a time", () => {
  it("shows a part, says how many of how many, and brings the next ones until the list ends", () => {
    render(draw(ITEMS, "todos"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 de 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 2" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    // The last press brings what is left, and says so.
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("5 de 5")).toBeNull();
  });

  it("starts again at the first part when the view or the search changes", () => {
    const { rerender } = render(draw(ITEMS, "todos"));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 2" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    rerender(draw(ITEMS.slice(0, 3), "receitas"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 de 3")).toBeTruthy();
  });

  it("says nothing under a list shown whole", () => {
    render(draw(ITEMS.slice(0, 2), "todos"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
