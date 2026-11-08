import { describe, expect, it } from "vitest";

import {
  conversationHref,
  INBOX_CARDS,
  INBOX_VIEWS,
  inboxHref,
  inboxListQuery,
  inboxPageOf,
  inboxViewGroup,
  inOrder,
  isInboxView,
  sortOfParam,
} from "@/lib/whatsapp/inbox-list";

const A = "21100000-0000-4000-8000-000000000001";
const B = "21100000-0000-4000-8000-000000000002";

describe("the views of the inbox", () => {
  it("are the database's, every card one of them, grouped as the bar lists them", () => {
    expect(INBOX_VIEWS).toEqual([
      "todas",
      "esperando",
      "fechando",
      "chamou",
      "resposta",
      "nao-lidas",
      "com-pessoa",
      "falhou",
      "pararam",
    ]);
    for (const card of INBOX_CARDS) expect(isInboxView(card)).toBe(true);
    expect(isInboxView("outra")).toBe(false);
    expect(INBOX_VIEWS.map(inboxViewGroup)).toEqual([
      "all",
      "waits",
      "waits",
      "waits",
      "waits",
      "waits",
      "other",
      "other",
      "other",
    ]);
  });
});

describe("what a person asks of the list", () => {
  it("reads only what is a query, the search trimmed to what the database reads", () => {
    expect(
      inboxListQuery({ view: "esperando", sort: "oldest", search: "  Paula ", module: "direito-do-passageiro" }),
    ).toEqual({
      view: "esperando",
      sort: "oldest",
      search: "Paula",
      module: "direito-do-passageiro",
    });
    expect(inboxListQuery({ view: "outra", sort: "nome", search: 12, module: " " })).toEqual({
      view: "todas",
      sort: "recent",
      search: "",
      module: null,
    });
    expect(inboxListQuery(null).view).toBe("todas");
    expect(inboxListQuery({ search: "x".repeat(300) }).search).toHaveLength(120);
  });

  it("writes the order in the address only when it is not the default", () => {
    expect(sortOfParam("antigas")).toBe("oldest");
    expect(sortOfParam("recent")).toBe("recent");
    expect(sortOfParam(undefined)).toBe("recent");
    expect(inboxHref({ view: "todas", sort: "recent", module: null })).toBe("/atendimento");
    expect(inboxHref({ view: "esperando", sort: "oldest", module: "direito-do-passageiro" })).toBe(
      "/atendimento?ver=esperando&ordem=antigas&modulo=direito-do-passageiro",
    );
    expect(conversationHref(A, { view: "chamou", sort: "recent", module: null })).toBe(
      `/atendimento?c=${A}&ver=chamou`,
    );
  });
});

describe("what the database answers", () => {
  it("is read whole, an id that is none and a count that is none left out", () => {
    expect(
      inboxPageOf({
        ids: [A, "nada", B],
        total: "3",
        counts: { todas: 7, esperando: "2", fechando: -1, outra: 9 },
      }),
    ).toEqual({
      ids: [A, B],
      total: 3,
      counts: {
        todas: 7,
        esperando: 2,
        fechando: 0,
        chamou: 0,
        resposta: 0,
        "nao-lidas": 0,
        "com-pessoa": 0,
        falhou: 0,
        pararam: 0,
      },
    });
  });

  it("is a read that failed when it is not a list, never an empty one", () => {
    expect(inboxPageOf(null)).toBeNull();
    expect(inboxPageOf({ ids: "x", counts: {} })).toBeNull();
    expect(inboxPageOf({ ids: [] })).toBeNull();
  });

  it("keeps the rows in the database's order, leaving out what could not be read", () => {
    expect(inOrder([B, A, "21100000-0000-4000-8000-000000000009"], [{ id: A }, { id: B }])).toEqual([
      { id: B },
      { id: A },
    ]);
  });
});
