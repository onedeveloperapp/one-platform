"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { getVault } from "@/lib/connections/vault";
import { getMemberContext } from "@/lib/member/context";
import {
  PSC_COLUMNS,
  PSC_COOKIE_PATH,
  PSC_STATE_COOKIE,
  pscClientFor,
  pscRedirectUri,
  type PscRow,
} from "@/lib/psc/provider";
import { isSignatureHours } from "@/lib/psc/signature";
import { connectionRefusal } from "@/lib/whatsapp/session";
import { onlyDigits } from "@flyee/fields";
import { challengeOf, newState, newVerifier } from "@flyee/psc/pkce";

/**
 * What a lawyer does with their signature in the cloud (migration 0041):
 * declare their CPF, so that the certificate they authorize is theirs;
 * authorize ONE at their PSC (they go to the PSC's page, asked for the
 * certificate of that CPF, and come back to `/api/connections/psc/callback`,
 * which keeps the authorization and tries it once); and end an
 * authorization, theirs or, for a partner or who manages the firm, a
 * colleague's. The database decides who may; nothing here trusts an id it is
 * handed beyond asking the database about it.
 */

export type SignatureActionResult = { ok: true; code: string; url?: string } | { ok: false; code: string };

/** The codes a function of the database raises, by the name the screen has words for. */
const raisedCode = (message: string | undefined): string =>
  ["second_factor_required", "not_allowed_in_support_session", "not_authorized"].find((code) =>
    (message ?? "").includes(code),
  ) ?? "failed";

/** The lawyer declares their own CPF (or changes it, while no authorization of theirs is in course). */
export async function declareLawyerCpf(cpf: string): Promise<SignatureActionResult> {
  const digits = onlyDigits(typeof cpf === "string" ? cpf : "");
  if (digits.length !== 11) return { ok: false, code: "invalid_cpf" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("declare_lawyer_cpf", { target_cpf: digits });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  revalidatePath("/settings/team");
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** Starts the lawyer's authorization at a PSC: the address of the PSC's page the lawyer goes to. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function startLawyerSignature(input: {
  psc: string;
  hours: number;
  /** The case the lawyer came from to authorize: offered back once the PSC answered. */
  backToCase?: string | null;
}): Promise<SignatureActionResult> {
  if (!isSignatureHours(input?.hours) || typeof input?.psc !== "string") return { ok: false, code: "invalid_data" };
  if (!getVault().ok) return { ok: false, code: "vault_not_configured" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (context.firm.firmFunction !== "socio" && context.firm.firmFunction !== "advogado") {
    return { ok: false, code: "not_a_lawyer" };
  }
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };

  const [{ data: row }, { data: declared }] = await Promise.all([
    context.supabase.from("psc_providers").select(PSC_COLUMNS).eq("slug", input.psc).eq("active", true).maybeSingle(),
    context.supabase.from("lawyer_cpfs").select("cpf").eq("user_id", context.userId).maybeSingle(),
  ]);
  if (!row) return { ok: false, code: "unknown_psc" };
  if (typeof declared?.cpf !== "string") return { ok: false, code: "cpf_required" };
  const client = await pscClientFor(row as PscRow);
  if (!client) return { ok: false, code: "psc_not_configured" };

  const { data, error } = await context.supabase.rpc("begin_lawyer_signature", {
    target_org: context.firm.id,
    target_psc: input.psc,
  });
  const answer = (data ?? {}) as { ok?: boolean; code?: string; connection_id?: string };
  if (error || !answer.ok || !answer.connection_id) {
    return { ok: false, code: error ? raisedCode(error.message) : String(answer.code ?? "failed") };
  }

  const verifier = newVerifier();
  const state = newState();
  // The case the lawyer came from goes with the start, by its id alone, to be offered back on the return.
  const backToCase = typeof input.backToCase === "string" && UUID.test(input.backToCase) ? input.backToCase : "";
  (await cookies()).set(
    PSC_STATE_COOKIE,
    [state, answer.connection_id, verifier, String(input.hours), backToCase].join("."),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: PSC_COOKIE_PATH,
      maxAge: 600,
    },
  );
  const url = client.provider.authorizeUrl({
    clientId: client.clientId,
    redirectUri: pscRedirectUri(),
    state,
    codeChallenge: challengeOf(verifier),
    scope: "signature_session",
    lifetimeSeconds: input.hours * 3600,
    // The PSC offers the certificates of this CPF: the lawyer's own.
    loginHint: declared.cpf,
  });
  return { ok: true, code: "redirect", url };
}

/** Ends an authorization: the lawyer's own, or a colleague's for a partner or who manages the firm. */
export async function endLawyerSignature(connectionId: string): Promise<SignatureActionResult> {
  if (typeof connectionId !== "string" || !/^[0-9a-f-]{36}$/.test(connectionId)) {
    return { ok: false, code: "invalid_data" };
  }
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("end_lawyer_signature", {
    target_connection: connectionId,
    target_only_pending: false,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  revalidatePath("/settings/team");
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}
