import type { CaseState } from "../case-types";
import type { RunningAction } from "./case-action";
import JourneyCard, { showTrail, TRAIL_ID } from "./journey-card";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveRead } from "@/components/product/use-live-read";
import { caseJourney, type JourneyFacts, NO_COURT_FACTS } from "@/lib/cases/journey";
import { caseNow, type CaseNowInput } from "@/lib/cases/now";
import messages from "@flyee/content/messages/pt-BR.json";
import { act, cleanup, render, screen } from "@testing-library/react";

// The top of a case, drawn from invented facts: who has the case, what ONE does now, what holds it and whose turn
// each thing is, in the screen's own words (the owner's audit, 2026-11-05).

type Ready = Extract<CaseState, { kind: "ready" }>;

const state = {
  kind: "ready",
  today: "2026-11-05",
  readAt: "2026-11-05T15:00:00Z",
  hearings: { now: "2026-11-05T15:00:00Z", durationMinutes: 60, upcoming: [], past: [], calendar: null },
  autonomy: {},
  events: [
    {
      id: "e1",
      at: "2026-11-05T14:58:00Z",
      kind: "filing_package_ready",
      actorType: "system",
      actorName: null,
      data: {},
    },
  ],
  lawyer: true,
  partner: true,
  managesFirm: true,
  team: [],
  decidesCourtSystem: true,
  confirmsDeadlines: true,
  worksDeadlines: true,
  supportVisit: false,
} as unknown as Ready;

const live: LiveRead = {
  live: true,
  checkedAt: Date.parse("2026-11-05T15:00:00Z"),
  failed: false,
  acted: () => {},
  checkNow: () => {},
  latest: async () => null,
  shows: () => false,
};

const input = (overrides: Partial<CaseNowInput>): CaseNowInput => ({
  status: "drafting",
  today: "2026-11-05",
  now: "2026-11-05T15:00:00Z",
  parties: [{ partyId: "pa", role: "claimant", person: { full_name: "Ana Teste", person_id: "pe-a" } }],
  documents: [],
  missing: [],
  civilCourt: [],
  account: "ready",
  interview: null,
  waiting: null,
  waitingSince: null,
  advance: null,
  linksOwed: [],
  envelopes: [],
  proceedings: [],
  drafts: [],
  filings: [],
  unnamedSigners: [],
  deadlines: [],
  hearings: [],
  hearingMinutes: 60,
  publications: [],
  complaints: [],
  statementsWorking: [],
  ...overrides,
});

const lawsuit = {
  id: "lw",
  kind: "juizado" as const,
  system: "projudi",
  status: "planned" as const,
  systemApproval: { by: "u", at: "2026-11-05T10:00:00Z" },
  systemRefusal: null,
};

function view(
  now: ReturnType<typeof caseNow>,
  facts: JourneyFacts = { signatureSince: null, filingSince: "2026-11-05T14:00:00Z" },
  screenState: { action?: RunningAction | null; syncing?: boolean } = {},
) {
  const journey = caseJourney({
    status: "drafting",
    createdAt: "2026-11-01T12:00:00Z",
    moments: [],
    court: NO_COURT_FACTS,
    facts,
  });
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <JourneyCard
        state={state}
        journey={journey}
        now={now}
        live={live}
        action={screenState.action ?? null}
        syncing={screenState.syncing ?? false}
        onJudgment={async () => {}}
      />
    </NextIntlClientProvider>
  );
}

function draw(...args: Parameters<typeof view>) {
  return render(view(...args));
}

afterEach(cleanup);

describe("JourneyCard", () => {
  it("says a package ready waits for a lawyer to file it, with the way to it", () => {
    draw(
      caseNow(
        input({
          proceedings: [lawsuit],
          drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
          filings: [
            {
              id: "fp",
              proceedingId: "lw",
              system: "projudi",
              status: "ready",
              blocker: null,
              signature: { takesSigned: true, status: "signed" },
            },
          ],
        }),
      ),
    );
    expect(screen.getByText("Com o escritório.")).toBeTruthy();
    expect(screen.getByText("Protocole a ação (Juizado especial cível) no Projudi e anexe o recibo.")).toBeTruthy();
    expect(screen.getByText("Um advogado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolver" })).toBeTruthy();
    expect(screen.getByText("O que o ONE fez há pouco")).toBeTruthy();
    expect(screen.getByText(/Atualizado às/)).toBeTruthy();
  });

  it("says what ONE is doing now, and that nothing holds the case", () => {
    draw(
      caseNow(
        input({
          proceedings: [lawsuit],
          drafts: [{ id: "dr", proceedingId: "lw", status: "generating", work: "generate" }],
        }),
      ),
      { signatureSince: null, filingSince: null },
    );
    expect(screen.getByText("Com o ONE.")).toBeTruthy();
    expect(screen.getByText("O ONE está fazendo agora")).toBeTruthy();
    expect(screen.getByText("O ONE está escrevendo a peça da ação (Juizado especial cível).")).toBeTruthy();
    expect(screen.getByText("Nada trava o caso: o ONE segue com ele.")).toBeTruthy();
  });

  it("asks whether a decision is the judgment only of who may say it, in place", () => {
    draw(
      caseNow(
        input({
          status: "filed",
          publications: [{ id: "p1", category: "decisao", availableOn: "2026-11-04", judgment: null, readings: [] }],
        }),
      ),
    );
    expect(
      screen.getByText("Saiu uma decisão em 04/11/2026, e o texto não deixa claro: ela é a sentença?"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "É a sentença" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Não é" })).toBeTruthy();
  });

  // The owner's canvas of the case's actions (2026-11-10): the top says the action under way and a reading of the
  // case, and marks what changed.
  const waiting = () =>
    caseNow(
      input({
        proceedings: [lawsuit],
        drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
        filings: [
          {
            id: "fp",
            proceedingId: "lw",
            system: "projudi",
            status: "ready",
            blocker: null,
            signature: { takesSigned: true, status: "signed" },
          },
        ],
      }),
    );

  it("says the person's action under way, and its ways wait until the screen shows what came of it", () => {
    draw(waiting(), undefined, {
      action: { key: "plan", section: "rules", doing: "criando os processos", saved: false },
    });
    expect(screen.getByText("Uma ação em andamento: criando os processos")).toBeTruthy();
    expect(screen.getByText("O andamento se atualiza assim que a ação terminar.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resolver" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Atualizado às/)).toBeNull();
  });

  it("says it reads the case again for a change made outside, with nothing locked", () => {
    draw(waiting(), undefined, { syncing: true });
    expect(screen.getByText("Atualizando o caso")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resolver" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("marks what changed with the next reading, never what the person found on arrival", () => {
    const { rerender } = draw(waiting());
    expect(screen.queryByText("Novo")).toBeNull();
    rerender(
      view(
        caseNow(
          input({
            proceedings: [lawsuit],
            drafts: [{ id: "dr", proceedingId: "lw", status: "generating", work: "generate" }],
          }),
        ),
        { signatureSince: null, filingSince: null },
      ),
    );
    expect(screen.getAllByText("Novo").length).toBeGreaterThan(0);
  });

  it("goes to the trail when a person's action moved it out of sight, and only marks it when it is in sight", () => {
    draw(waiting());
    const trail = document.getElementById(TRAIL_ID) as HTMLElement;
    const scrolled = vi.fn();
    trail.scrollIntoView = scrolled;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const at = (top: number) =>
      vi.spyOn(trail, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 400 } as DOMRect);

    // The person acted in a card far below: the trail is above the screen.
    at(-900);
    act(() => {
      expect(showTrail()).toBe(true);
    });
    expect(scrolled).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(trail.className).toContain("ring-4");

    // The trail's head already in sight: the screen stays where it is, and the trail is marked all the same.
    scrolled.mockClear();
    at(120);
    act(() => {
      expect(showTrail()).toBe(false);
    });
    expect(scrolled).not.toHaveBeenCalled();
  });
});
