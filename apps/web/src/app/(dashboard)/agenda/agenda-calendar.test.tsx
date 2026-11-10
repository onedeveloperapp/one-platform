import AgendaCalendar from "./agenda-calendar";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readAgendaItems } from "@/lib/agenda/agenda";
import catalog from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The agenda's day, week and month (migration 0132), drawn from invented items: what each person answers for, the
// days a month's grid moves between with the arrows, and the case one click away.

const ANA = "a1000000-0000-4000-8000-000000000001";
const CAIO = "a1000000-0000-4000-8000-000000000002";

const items = readAgendaItems(
  {
    deadlines: [
      {
        id: "d1",
        act: "replica",
        act_name: "Réplica",
        title: "Réplica",
        status: "confirmed",
        due_on: "2026-11-23",
        starts_on: "2026-11-02",
        explanation: null,
        case_id: "c1",
        case_seq: 12,
        is_test: false,
        cnj: "1000301-27.2099.8.09.0100",
        court: "TJGO",
        changed_at: null,
        people: [CAIO],
      },
    ],
    hearings: [
      {
        id: "h1",
        kind: "conciliacao",
        mode: "videoconferencia",
        status: "scheduled",
        starts_at: "2026-11-12T13:00:00Z",
        time_zone: "America/Sao_Paulo",
        case_id: "c2",
        case_seq: 13,
        is_test: false,
        cnj: "1000302-12.2099.8.09.0100",
        court: "TJGO",
        attendee_user_id: ANA,
        changed_at: null,
        people: [ANA],
      },
    ],
    duration_minutes: 60,
  },
  2,
);

vi.mock("@/lib/agenda/actions", () => ({
  readAgenda: vi.fn(async () => ({
    ok: true,
    items,
    internalDays: 2,
    me: { id: ANA, wholeFirm: false, digestOn: true, calendarAt: null, setsInternalDays: false },
  })),
}));

function Screen({ mode, day }: { mode: "dia" | "semana" | "mes"; day: string }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={{ product: catalog.product }} timeZone="America/Sao_Paulo">
      <AgendaCalendar
        mode={mode}
        day={day}
        meId={ANA}
        colleagues={[
          { id: ANA, name: "Ana" },
          { id: CAIO, name: "Caio" },
        ]}
        module={null}
        onDay={() => undefined}
      />
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe("the agenda by day, week and month", () => {
  it("shows a person's own items, and a month's days the arrows move between", async () => {
    render(<Screen mode="mes" day="2026-11-12" />);
    const twelfth = await screen.findByRole("button", { name: /12 de novembro: 1 item/ });
    expect(twelfth.getAttribute("tabindex")).toBe("0");
    // Caio's deadline of the 23rd is not Ana's.
    expect(screen.getByRole("button", { name: /23 de novembro: nada/ })).toBeTruthy();
    fireEvent.keyDown(twelfth, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/13 de novembro/);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/20 de novembro/);
  });

  it("opens a day with what is in it and the way to its case", async () => {
    render(<Screen mode="dia" day="2026-11-12" />);
    expect(await screen.findByText(/10:00 · Audiência de conciliação · #13/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir o caso" }).getAttribute("href")).toBe("/casos/c2");
  });
});
