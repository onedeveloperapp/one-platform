import { describe, expect, it } from "vitest";

import {
  AGENCY_TEST_PHONE,
  IN_THE_AIR,
  isTestChatPhone,
  LAST_LEG,
  legForTool,
  messagePartsOf,
  NEXT_TO_LEAVE,
  TEST_TOOLS,
  testTripInFront,
} from "@/lib/test-chat/test-chat";
import { isValidPhoneBr } from "@flyee/fields";

// The addresses here are invented.

describe("the firm's words in the test chat", () => {
  it("makes the client's link of ONE's message a link, and keeps the words around it as they are", () => {
    const body =
      "Pronto, Mariana. Os próximos passos:\n1. Abra o seu link: https://one.example/c/AbC-123_x\n2. Preencha.";
    expect(messagePartsOf(body)).toEqual([
      { text: "Pronto, Mariana. Os próximos passos:\n1. Abra o seu link: " },
      { text: "https://one.example/c/AbC-123_x", href: "https://one.example/c/AbC-123_x" },
      { text: "\n2. Preencha." },
    ]);
  });

  it("leaves out of the link the mark that ends a sentence", () => {
    expect(messagePartsOf("Abra https://one.example/c/abc. Depois, envie os documentos.")).toEqual([
      { text: "Abra " },
      { text: "https://one.example/c/abc", href: "https://one.example/c/abc" },
      { text: ". Depois, envie os documentos." },
    ]);
  });

  it("answers the words whole when they have no address, or only the start of one", () => {
    expect(messagePartsOf("Recebi tudo o que o seu caso precisa.")).toEqual([
      { text: "Recebi tudo o que o seu caso precisa." },
    ]);
    expect(messagePartsOf("Veja https://.")).toEqual([{ text: "Veja https://." }]);
  });
});

describe("the test chat's numbers", () => {
  it("are phones to the forms however they are written, and no real number is one", () => {
    expect(isTestChatPhone(AGENCY_TEST_PHONE)).toBe(true);
    expect(isTestChatPhone("(00) 98888-0006")).toBe(true);
    expect(isTestChatPhone("00988880001")).toBe(true);
    // A real Brazilian mobile is never one, and a test number is never a real one.
    expect(isTestChatPhone("(62) 99999-0001")).toBe(false);
    expect(isTestChatPhone("00988880016")).toBe(false);
    expect(isValidPhoneBr("(00) 98888-0006")).toBe(false);
  });
});

describe("the tools that make a flight go as it should (0084)", () => {
  // The legs of a trip with a connection, given out of order: the tools take them in the order they fly.
  const legs = [
    { position: 2, departure: "2099-11-20T09:00", status: "scheduled", departed: false, arrived: false },
    { position: 1, departure: "2099-11-20T06:10", status: "scheduled", departed: false, arrived: false },
  ];

  it("make the next leg leave, and the leg in the air land", () => {
    expect(legForTool(NEXT_TO_LEAVE, legs)).toBe(1);
    expect(legForTool(IN_THE_AIR, legs)).toBeNull();
    const first = legs.map((leg) => (leg.position === 1 ? { ...leg, departed: true } : leg));
    expect(legForTool(IN_THE_AIR, first)).toBe(1);
    expect(legForTool(NEXT_TO_LEAVE, first)).toBe(2);
    const landed = first.map((leg) => (leg.position === 1 ? { ...leg, arrived: true, status: "landed" } : leg));
    expect(legForTool(IN_THE_AIR, landed)).toBeNull();
    expect(legForTool(NEXT_TO_LEAVE, landed)).toBe(2);
  });

  it("never move a cancelled leg, and say when there is nothing to move", () => {
    const cancelled = legs.map((leg) => (leg.position === 1 ? { ...leg, status: "cancelled" } : leg));
    expect(legForTool(NEXT_TO_LEAVE, cancelled)).toBe(2);
    const done = legs.map((leg) => ({ ...leg, departed: true, arrived: true, status: "landed" }));
    expect(legForTool(NEXT_TO_LEAVE, done)).toBeNull();
    expect(legForTool(IN_THE_AIR, done)).toBeNull();
  });

  it("keep the last leg the trip's own, and a leg named by its position as it is", () => {
    expect(legForTool(LAST_LEG, legs)).toBe(2);
    expect(legForTool(1, legs)).toBe(1);
  });

  it("are the agency's trip's, after the problems it was made for", () => {
    expect(TEST_TOOLS.agencia.map((tool) => tool.key)).toEqual(["cancel", "late_6h", "depart", "land"]);
  });
});

describe("the trip in front of the tester", () => {
  it("is the agency's or the firm's passenger still followed, the agency's first", () => {
    const trips = [
      { label: "escritorio", status: "case_opened" },
      { label: "agencia", status: "watching" },
      { label: "voo_real", status: "watching" },
    ];
    expect(testTripInFront(trips)?.label).toBe("agencia");
    expect(
      testTripInFront([
        { label: "escritorio", status: "alerted" },
        { label: "agencia", status: "declined" },
      ])?.label,
    ).toBe("escritorio");
    expect(testTripInFront([{ label: "voo_real", status: "watching" }])).toBeNull();
  });
});

describe("a test firm's tools (0220)", () => {
  it("reads the view of the firm's link, its trips and legs, and nothing of a link that opens nothing", async () => {
    const { testFirmViewOf, firmToolOf } = await import("./test-chat");
    expect(testFirmViewOf({ found: false })).toBeNull();
    const view = testFirmViewOf({
      found: true,
      firm: "Souza Advogados",
      number: { phone: "5562900002201", provider: "openwa" },
      delay_minutes: 240,
      trips: [
        {
          id: "e2200000-0000-4000-8000-00000000000a",
          passenger: "Passageira Teste",
          phone_end: "0001",
          status: "watching",
          from_agency: true,
          case_id: null,
          legs: [
            {
              position: 1,
              flight: "LA3456",
              origin: "GRU",
              destination: "REC",
              departure: "2099-01-10T08:10:00",
              arrival: "2099-01-10T11:25:00",
              status: "scheduled",
              estimated_arrival: null,
              departed: "2099-01-10T08:12:00",
              arrived: null,
            },
            { position: 2, flight: "", origin: "REC", destination: "GRU" },
          ],
        },
        { id: "not-a-trip" },
      ],
    });
    expect(view?.number).toEqual({ phone: "5562900002201", provider: "openwa" });
    expect(view?.trips).toHaveLength(1);
    expect(view?.trips[0].legs).toHaveLength(1);
    expect(view?.trips[0].legs[0]).toMatchObject({ departed: true, arrived: false, status: "scheduled" });
    expect(firmToolOf("cancel")?.legs).toEqual([{ position: 1, status: "cancelled" }]);
    expect(firmToolOf("late_short")).toBeNull();
  });
});
