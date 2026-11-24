"use server";

import { revalidatePath } from "next/cache";

import { type DjenCases, djenCasesOf } from "@/lib/import/djen-cases";
import { queueDjenCases } from "@/lib/import/djen-cases-work";
import { type DjenLawsuit, readDjenLawsuits } from "@/lib/import/djen-lawsuits";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * The lawsuits the DJEN already shows of the firm's lawyers and the firm has no lawsuit of (migration 0208), for who
 * may import the portfolio. A refusal says why.
 */
export async function readFirmDjenLawsuits(): Promise<
  { ok: true; total: number; lawsuits: DjenLawsuit[] } | { ok: false; code: string }
> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("firm_djen_lawsuits", {
    target_org: context.firm.id,
    target_limit: 5000,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  const read = readDjenLawsuits(data);
  return read ? { ok: true, ...read } : { ok: false, code: "failed" };
}

/** What ONE opened from the DJEN for the firm (migration 0287), for who may import the portfolio. */
export async function readFirmDjenCases(): Promise<{ ok: true; cases: DjenCases } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("firm_djen_cases", { target_org: context.firm.id });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  const cases = djenCasesOf(data);
  return cases ? { ok: true, cases } : { ok: false, code: "failed" };
}

/**
 * A partner, a lawyer or the controladoria of a firm that keeps the decision with a person asks ONE to open the
 * cases of the lawsuits the DJEN shows (0287): a few are read right after the answer, the rest by the sweep.
 */
export async function askDjenCases(): Promise<{ ok: true; lawsuits: number } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (await isSupportVisit()) return { ok: false, code: "support_visit" };
  const { data, error } = await context.supabase.rpc("ask_djen_cases", { target_org: context.firm.id });
  if (error) return { ok: false, code: error.message.includes("second_factor_required") ? "second_factor" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; lawsuits?: number };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  if (answer.code === "queued") queueDjenCases(context.firm.id);
  revalidatePath("/casos/importar");
  return { ok: true, lawsuits: Number(answer.lawsuits ?? 0) };
}

/**
 * The firm gives the CPF of a client ONE named from the DJEN (0287): saved on them, or, when the firm already has a
 * person of that name with that CPF, the case becomes theirs. A refusal says why.
 */
export async function completeDjenClient(
  personId: string,
  cpf: string,
): Promise<{ ok: true; merged: boolean } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || typeof personId !== "string" || !/^[0-9a-f-]{36}$/i.test(personId)) {
    return { ok: false, code: "not_found" };
  }
  const { data, error } = await context.supabase.rpc("complete_djen_client", {
    target_person: personId,
    target_cpf: typeof cpf === "string" ? cpf.replace(/\D/g, "").slice(0, 11) : "",
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  revalidatePath("/casos/importar");
  return { ok: true, merged: answer.code === "merged" };
}
