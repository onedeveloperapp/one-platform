import type { CaseState } from "../case-types";
import JourneyCard from "./journey-card";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { LiveRead } from "@/components/product/use-live-read";
import { caseJourney, NO_COURT_FACTS } from "@/lib/cases/journey";
import type { CaseNow, NowItem } from "@/lib/cases/now";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The top of a case as one compact card (the owner's canvas "ONE · O caso em abas", 2026-11-25): what the firm resolves
// in whole lines, the client's turns in one line that opens their list, and the forecast at the side. Invented facts.

type Ready = Extract<CaseState, { kind: "ready" }>;

const state = {
  kind: "ready",
  today: "2026-11-25",
  readAt: "2026-11-25T14:20:00Z",
  hearings: { now: "2026-11-25T14:20:00Z", durationMinutes: 60, upcoming: [], past: [], calendar: null },
  autonomy: {},
  events: [],
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
  checkedAt: Date.parse("2026-11-25T14:20:00Z"),
  failed: false,
  acted: () => {},
  checkNow: () => {},
};

const line = (id: string, owner: NowItem["owner"], key: string, values: Record<string, string | number>): NowItem => ({
  id,
  owner,
  actor: owner === "firm" ? "lawyer" : null,
  tone: owner === "firm" ? "attention" : "waiting",
  text: { key, values } as NowItem["text"],
  section: owner === "firm" ? "publications" : "documents",
  href: null,
  since: null,
  ask: null,
  fields: null,
  slow: false,
});

const now = (blocking: NowItem[]): CaseNow => ({ working: [], later: [], blocking, holder: "firm", sections: {} });

const firm = line("ack", "firm", "case-now-publications-ack", { count: 1, names: "Paulo Mendes" });
const identity = line("doc-id", "client", "case-now-missing-document", {
  document: "Documento de identidade",
  name: "Marina Alves Pereira",
});
const address = line("doc-address", "client", "case-now-missing-document", {
  document: "Comprovante de endereço",
  name: "Marina Alves Pereira",
});
const flight = line("flight", "client", "case-now-missing-flight", {});

function draw(lines: NowItem[], aside: ReactNode = null) {
  const journey = caseJourney({
    status: "filed",
    createdAt: "2026-11-01T12:00:00Z",
    moments: [],
    court: NO_COURT_FACTS,
    facts: { signatureSince: null, filingSince: null },
  });
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <JourneyCard
        state={state}
        journey={journey}
        now={now(lines)}
        live={live}
        action={null}
        syncing={false}
        onJudgment={async () => {}}
        aside={aside}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("the top of the case in one card", () => {
  it("says what the firm resolves in whole lines, and the client's turns in one line that opens their list", () => {
    draw([firm, identity, address, flight]);
    expect(screen.getByText(/falta a ciência de Paulo Mendes/)).toBeTruthy();
    expect(screen.getByText("3 coisas esperam o cliente")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Ver as 3" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Esconder" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Comprovante de endereço de Marina Alves Pereira/)).toBeTruthy();
    expect(screen.getByText(/Os dados do voo/)).toBeTruthy();
  });

  it("says one turn of the client as it is, with no line that groups it", () => {
    draw([firm, flight]);
    expect(screen.getByText(/Os dados do voo: o cliente envia pelo link/)).toBeTruthy();
    expect(screen.queryByText(/coisas esperam o cliente/)).toBeNull();
  });

  it("puts the forecast at the side of the top", () => {
    draw([firm], <p>Previsão ao lado</p>);
    expect(screen.getByText("Previsão ao lado")).toBeTruthy();
  });
});
