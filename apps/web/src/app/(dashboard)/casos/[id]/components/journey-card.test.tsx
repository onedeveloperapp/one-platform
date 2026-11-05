import type { CaseState } from "../case-types";
import JourneyCard from "./journey-card";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { LiveRead } from "@/components/product/use-live-read";
import { caseJourney, type JourneyFacts, NO_COURT_FACTS } from "@/lib/cases/journey";
import { caseNow, type CaseNowInput } from "@/lib/cases/now";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, render, screen } from "@testing-library/react";

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

function draw(
  now: ReturnType<typeof caseNow>,
  facts: JourneyFacts = { signatureSince: null, filingSince: "2026-11-05T14:00:00Z" },
) {
  const journey = caseJourney({
    status: "drafting",
    createdAt: "2026-11-01T12:00:00Z",
    moments: [],
    court: NO_COURT_FACTS,
    facts,
  });
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <JourneyCard state={state} journey={journey} now={now} live={live} onJudgment={async () => {}} />
    </NextIntlClientProvider>,
  );
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
});
