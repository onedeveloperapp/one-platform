"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";

import { addDays, type AgendaItems, digestFor, digestHour, isBusinessDay, readAgendaItems } from "@/lib/agenda/agenda";
import { dayWords, lineWords } from "@/lib/agenda/digest-work";
import { getMemberContext } from "@/lib/member/context";
import { BRAND } from "@flyee/content";
import { type AgendaDigestLine, isEmailConfigured } from "@flyee/email";

/**
 * The agenda of each person (migration 0132): what a range of days holds, the firm's internal days, the person's
 * e-mail of the morning and their calendar link. Each write goes through its database function, which checks who may
 * and keeps it on the record.
 */

export type AgendaRead =
  | {
      ok: true;
      items: AgendaItems;
      internalDays: number;
      me: { id: string; wholeFirm: boolean; digestOn: boolean; calendarAt: string | null; setsInternalDays: boolean };
    }
  | { ok: false; code: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The items of the days from `from` to `to` (at most 62), under a module or every one. */
export async function readAgenda(from: string, to: string, module: string | null): Promise<AgendaRead> {
  if (!DAY.test(from) || !DAY.test(to)) return { ok: false, code: "invalid_range" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("firm_agenda", {
    target_org: context.firm.id,
    from_day: from,
    to_day: to,
    target_module: module,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  const days = typeof answer.internal_days === "number" ? answer.internal_days : 0;
  const me = (answer.me ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    items: readAgendaItems(answer, days),
    internalDays: days,
    me: {
      id: typeof me.id === "string" ? me.id : "",
      wholeFirm: me.whole_firm === true,
      digestOn: me.digest_on !== false,
      calendarAt: typeof me.calendar_at === "string" ? me.calendar_at : null,
      setsInternalDays: me.sets_internal_days === true,
    },
  };
}

type Result = { ok: true } | { ok: false; code: string };

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Result & { answer?: Record<string, unknown> }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, { target_org: context.firm.id, ...args });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  revalidatePath("/agenda");
  revalidatePath("/prazos");
  return { ok: true, answer };
}

/** A partner or the controladoria says how many business days before the fatal deadline the internal one comes. */
export async function setInternalDeadlineDays(days: number): Promise<Result> {
  if (!Number.isInteger(days) || days < 0 || days > 15) return { ok: false, code: "invalid_data" };
  return call("set_internal_deadline_days", { target_days: days });
}

/** The person stops or starts their e-mail of the morning. */
export async function setAgendaDigest(on: boolean): Promise<Result> {
  return call("set_agenda_digest", { target_on: on === true });
}

/**
 * The person makes their calendar link, or a new one (the one before stops answering). The address is shown this
 * once: ONE keeps only the SHA-256 of its token, and nobody can read it back.
 */
export async function startAgendaCalendar(): Promise<
  { ok: true; url: string; webcal: string } | { ok: false; code: string }
> {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await call("start_agenda_calendar", { target_hash: hash });
  if (!result.ok) return result;
  const url = `${BRAND.siteUrl}/api/public/agenda/${token}.ics`;
  return { ok: true, url, webcal: url.replace(/^https?:/, "webcal:") };
}

/** The person ends their calendar link: it stops answering at once. */
export async function endAgendaCalendar(): Promise<Result> {
  return call("end_agenda_calendar", {});
}

export type MorningPreview = {
  /** The day of Brasília it is the e-mail of, in words ("terça-feira, 10 de novembro"). */
  day: string;
  businessDay: boolean;
  /** Whether this environment sends e-mail at all (the provider's key). */
  configured: boolean;
  wholeFirm: boolean;
  today: AgendaDigestLine[];
  next: AgendaDigestLine[];
};

/**
 * The person's e-mail of this morning (0132) as the backend would write it, shown on the agenda's panel: the same
 * items, the same words and the same rule, whether or not this environment sends e-mail.
 */
export async function previewMorningEmail(): Promise<
  { ok: true; preview: MorningPreview } | { ok: false; code: string }
> {
  const now = new Date();
  const { day: today } = digestHour(now);
  const read = await readAgenda(today, addDays(today, 2), null);
  if (!read.ok) return read;
  const digest = digestFor(read.items, { userId: read.me.id, wholeFirm: read.me.wholeFirm }, today, now);
  return {
    ok: true,
    preview: {
      day: dayWords(today),
      businessDay: isBusinessDay(today),
      configured: isEmailConfigured,
      wholeFirm: read.me.wholeFirm,
      today: digest.today.map((line) => lineWords(line, today)),
      next: digest.next.map((line) => lineWords(line, today)),
    },
  };
}
