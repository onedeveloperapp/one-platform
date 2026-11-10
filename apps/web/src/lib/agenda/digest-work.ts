import "server-only";

import { addDays, digestFor, digestHour, type DigestLine, readAgendaItems, weekdayNumber } from "@/lib/agenda/agenda";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import { BRAND } from "@flyee/content";
import { type AgendaDigestLine, isEmailConfigured, sendAgendaDigestEmail } from "@flyee/email";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The e-mail of the morning (migration 0132), the backend's half: on a business morning of Brasília, each person of a
 * firm who did not stop it is sent their deadlines and hearings of the day and of the next 48 hours, when there is
 * something; the partners and the controladoria the whole firm's. Each e-mail is reserved before it goes, so none goes
 * twice; a refusal by the provider's quota gives the turn back and stops the round. Without the provider's key nothing
 * is reserved, so the e-mail goes the morning the key exists.
 */

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "terça-feira, 10 de novembro". */
export const dayWords = (day: string): string =>
  `${WEEKDAYS[weekdayNumber(day)]}, ${Number.parseInt(day.slice(8, 10), 10)} de ${MONTHS[Number.parseInt(day.slice(5, 7), 10) - 1]}`;

/** One line of the e-mail, in the reader's words: what, the case's number, when; never a typed title. */
export function lineWords(line: DigestLine, today: string): AgendaDigestLine {
  const when =
    line.day === today ? null : line.day === addDays(today, 1) ? "amanhã" : (WEEKDAYS[weekdayNumber(line.day)] ?? null);
  const time = line.time ? `às ${line.time}${line.zone ? ` (${line.zone})` : ""}` : null;
  const text = [
    line.name,
    line.caseWords,
    line.cnj ? `processo ${line.cnj}` : null,
    [when, time].filter(Boolean).join(" ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    text: line.cancelled ? `${text} · cancelada` : text,
    url: line.caseId ? `${BRAND.siteUrl}/casos/${line.caseId}` : null,
    changed: line.changed,
  };
}

/** A refusal by the provider's quota or rate: the turn is given back. */
const isQuota = (error: string | undefined): boolean => /quota|rate.?limit|too many|429/i.test(error ?? "");

type Owed = {
  org_id: string;
  firm_name: string;
  internal_days: number;
  people: { user_id: string; email: string; name: string; stop_token: string | null; whole_firm: boolean }[] | null;
  items: unknown;
};

export async function agendaDigestRound(
  service: SupabaseClient,
  until: number,
  now: Date = new Date(),
): Promise<SweepReport> {
  const { day, due } = digestHour(now);
  if (!due) return { due: false };
  if (!isEmailConfigured) return { due: true, email: false };
  const report = { due: true, sent: 0, empty: 0, failed: 0, quota: 0, rounds: 0 };
  while (Date.now() < until) {
    report.rounds += 1;
    const { data, error } = await service.rpc("agenda_digests_owed", {
      target_day: day,
      target_to: addDays(day, 2),
      target_firms: 3,
    });
    if (error) throw new Error("agenda_digests_owed failed");
    const firms = (Array.isArray(data) ? data : []) as Owed[];
    if (firms.length === 0) break;
    let progressed = false;
    for (const firm of firms) {
      const items = readAgendaItems(firm.items, firm.internal_days);
      for (const person of firm.people ?? []) {
        if (Date.now() >= until) return report;
        const digest = digestFor(items, { userId: person.user_id, wholeFirm: person.whole_firm }, day, now);
        const count = digest.today.length + digest.next.length;
        const { data: reserved, error: reserveError } = await service.rpc("reserve_agenda_digest", {
          target_org: firm.org_id,
          target_user: person.user_id,
          target_day: day,
          target_items: count,
        });
        if (reserveError) throw new Error("reserve_agenda_digest failed");
        progressed = true;
        if (count === 0) {
          report.empty += 1;
          continue;
        }
        if (typeof reserved !== "string") continue;
        const result = await sendAgendaDigestEmail(person.email, {
          locale: "pt-BR",
          firmName: firm.firm_name,
          dayLabel: dayWords(day),
          wholeFirm: person.whole_firm,
          today: digest.today.map((line) => lineWords(line, day)),
          next: digest.next.map((line) => lineWords(line, day)),
          agendaUrl: `${BRAND.siteUrl}/agenda?modo=dia`,
          unsubscribeUrl: `${BRAND.siteUrl}/api/public/agenda/parar?t=${person.stop_token ?? ""}`,
        });
        const outcome = result.sent ? "sent" : isQuota(result.error) ? "quota" : "failed";
        await service.rpc("finish_agenda_digest", {
          target_digest: reserved,
          target_outcome: outcome,
          // The provider's words only: never an address or a person's data.
          target_error:
            outcome === "failed" ? (result.error ?? "").replace(/\S+@\S+/g, "[e-mail]").slice(0, 200) : null,
        });
        if (outcome === "quota") {
          report.quota += 1;
          return report;
        }
        if (outcome === "sent") report.sent += 1;
        else report.failed += 1;
      }
    }
    if (!progressed) break;
  }
  return report;
}

export const agendaSweeps: Sweep[] = [
  {
    // The clock's alone: the e-mail is of the morning, whoever is using ONE.
    key: "agenda-digests",
    when: { every: 15 },
    run: (service, until) => agendaDigestRound(service, until),
  },
];
