"use server";

import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's attendees from outside (migration 0251, the owner, 2026-11-14): who goes to a hearing for the firm with
 * no account in ONE, kept by name and WhatsApp where the firm takes notice of a hearing and offered for the next
 * ones. By the WhatsApp ONE sends them the hearing's guide and knows their report (0187, 0247). Read under the
 * person's session; written by the database functions that own the rules (never the firm's own number nor a
 * colleague's), which keep the audit event of each write.
 */

export type HearingContact = { id: string; name: string; phone: string };

export type HearingContactsResult = { ok: true; contacts: HearingContact[] } | { ok: false };

export type HearingContactResult =
  | { ok: true; contact: HearingContact }
  | { ok: false; code: string; field: "name" | "phone" | null };

/** The attendees of the person's firm still in its list, by name. */
export async function hearingContacts(): Promise<HearingContactsResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const { data, error } = await context.supabase
    .from("hearing_contacts")
    .select("id, name, phone")
    .eq("org_id", context.firm.id)
    .is("archived_at", null)
    .order("name", { ascending: true })
    .limit(500);
  if (error) return { ok: false };
  return { ok: true, contacts: (data ?? []) as HearingContact[] };
}

/** Somebody of the firm adds an attendee from outside to the list, by name and WhatsApp. */
export async function addHearingContact(input: { name: string; phone: string }): Promise<HearingContactResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed", field: null };
  const name = String(input?.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const phone = String(input?.phone ?? "")
    .replace(/\D/g, "")
    .slice(0, 13);
  const { data, error } = await context.supabase.rpc("save_hearing_contact", {
    target_org: context.firm.id,
    target_name: name,
    target_phone: phone,
  });
  if (error) return { ok: false, code: "failed", field: null };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown; field?: unknown; id?: unknown };
  if (!answer.ok || typeof answer.id !== "string") {
    const field = answer.field === "name" || answer.field === "phone" ? answer.field : null;
    return { ok: false, code: String(answer.code ?? "failed"), field };
  }
  const digits = phone.length === 10 || phone.length === 11 ? `55${phone}` : phone;
  return { ok: true, contact: { id: answer.id, name, phone: digits } };
}

/** Somebody of the firm takes an attendee out of the list; the hearings they were chosen for keep them. */
export async function removeHearingContact(contactId: string): Promise<{ ok: boolean }> {
  const context = await getMemberContext();
  if (!context?.firm || !/^[0-9a-f-]{36}$/i.test(String(contactId ?? ""))) return { ok: false };
  const { data, error } = await context.supabase.rpc("archive_hearing_contact", { target_contact: contactId });
  const answer = (data ?? {}) as { ok?: boolean };
  if (error || !answer.ok) return { ok: false };
  return { ok: true };
}
