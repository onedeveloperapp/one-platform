import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { isNoticeKind, type NoticeKind } from "@/lib/notices/notices";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screens read of the notices to clients (migration 0038), under
 * the person's own session: the firm's kinds for its settings
 * (`firm_notices`) and a case's people, what went and what is due
 * (`case_notices`). Moments are written on the server, on the reader's clock.
 */

export type FirmNoticeKind = {
  kind: NoticeKind;
  /** The text the platform proposes. */
  proposed: string;
  footer: string;
  /** What each value of the text is, in order, and a value of each, as an example. */
  params: string[];
  examples: string[];
  enabled: boolean;
  /** The text the firm submitted; none until it did. */
  body: string | null;
  template: { name: string; status: string; category: string } | null;
  /** A new text of a kind that is on, still with the vendor: the one above is used until it is approved. */
  pending: { name: string; status: string; category: string; body: string } | null;
  /** Why the kind cannot go now, as the line would read it. */
  blocker: string | null;
};

export type FirmNotices = {
  /** How many notices a firm sends in 24 hours (the setting's ceiling), and how many went in the last 24 hours. */
  dailyMax: number;
  lastDay: number;
  /** How many accounts at the vendor the firm's active numbers are of. */
  accounts: number;
  /** The days before a hearing its reminders go (0: the day itself), and every how many days the word on a lawsuit. */
  hearingDays: number[];
  updateDays: number;
  kinds: FirmNoticeKind[];
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

export async function firmNotices(supabase: SupabaseClient, firmId: string): Promise<FirmNotices> {
  const { data, error } = await supabase.rpc("firm_notices", { target_org: firmId });
  if (error || typeof data !== "object" || data === null) throw new Error("the notices could not be read");
  const answer = data as Record<string, unknown>;
  const kinds = list(answer.kinds).flatMap((row): FirmNoticeKind[] => {
    if (!isNoticeKind(row.kind)) return [];
    const template = row.template as Record<string, unknown> | null;
    const pending = row.pending as Record<string, unknown> | null;
    return [
      {
        kind: row.kind,
        proposed: String(row.proposed ?? ""),
        footer: String(row.footer ?? ""),
        params: Array.isArray(row.params) ? row.params.map(String) : [],
        examples: Array.isArray(row.examples) ? row.examples.map(String) : [],
        enabled: row.enabled === true,
        body: text(row.body),
        template: template
          ? {
              name: String(template.name ?? ""),
              status: String(template.status ?? ""),
              category: String(template.category ?? ""),
            }
          : null,
        pending: pending
          ? {
              name: String(pending.name ?? ""),
              status: String(pending.status ?? ""),
              category: String(pending.category ?? ""),
              body: String(pending.body ?? ""),
            }
          : null,
        blocker: text(row.blocker),
      },
    ];
  });
  return {
    dailyMax: count(answer.daily_max),
    lastDay: count(answer.last_day),
    accounts: count(answer.accounts),
    hearingDays: (Array.isArray(answer.hearing_days) ? answer.hearing_days : [])
      .filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0)
      .sort((a, b) => b - a),
    updateDays: count(answer.update_days) || 15,
    kinds,
  };
}

export type CaseNoticePerson = {
  personId: string;
  name: string;
  phone: string | null;
  /**
   * The person's request to stop the notices, in force (0088): made on their link, or recorded by a person of the
   * firm saying how. Nobody is asked to agree: a person with no request is told.
   */
  stop: { source: "client" | "firm"; recordedLabel: string; note: string | null } | null;
  /** Why the person cannot be told now. */
  blocker: string | null;
};

export type CaseNoticeSent = {
  id: string;
  kind: string;
  personId: string;
  reservedLabel: string;
  status: string;
  error: string | null;
  body: string;
};

export type CaseNotices = {
  kindsOn: NoticeKind[];
  people: CaseNoticePerson[];
  sent: CaseNoticeSent[];
  due: { kind: string; personId: string; blocker: string | null }[];
};

export async function caseNotices(
  supabase: SupabaseClient,
  caseId: string,
  timeZone: string | null | undefined,
): Promise<CaseNotices> {
  const { data, error } = await supabase.rpc("case_notices", { target_case: caseId });
  if (error || typeof data !== "object" || data === null) throw new Error("the notices of the case could not be read");
  const answer = data as Record<string, unknown>;
  return {
    kindsOn: (Array.isArray(answer.kinds_on) ? answer.kinds_on : []).flatMap((kind) =>
      isNoticeKind(kind) ? [kind] : [],
    ),
    people: list(answer.people).map((row) => {
      const stop = row.stop as Record<string, unknown> | null;
      return {
        personId: String(row.person_id),
        name: String(row.name ?? ""),
        phone: text(row.phone),
        stop:
          stop && typeof stop === "object"
            ? {
                source: stop.source === "client" ? "client" : "firm",
                recordedLabel: momentLabel(String(stop.recorded_at ?? ""), timeZone),
                note: text(stop.note),
              }
            : null,
        blocker: text(row.blocker),
      };
    }),
    sent: list(answer.sent).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      personId: String(row.person_id),
      reservedLabel: momentLabel(String(row.reserved_at ?? ""), timeZone),
      status: String(row.status ?? "queued"),
      error: text(row.error),
      body: String(row.body ?? ""),
    })),
    due: list(answer.due).map((row) => ({
      kind: String(row.kind),
      personId: String(row.person_id),
      blocker: text(row.blocker),
    })),
  };
}
