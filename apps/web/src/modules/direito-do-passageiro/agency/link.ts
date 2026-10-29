import "server-only";

import { createAnonClient } from "@/lib/public-content";
import {
  type AgreementView,
  agreementViewOf,
  isAgreementToken,
} from "@/modules/direito-do-passageiro/agency/agreement";

/**
 * What the passenger's page reads (migration 0070, `pax_link_open`), through the anonymous client: the token is
 * the only credential, and a link that is not open says why (ended, expired, the partnership over). Null when it
 * could not be read now, which the page says as a failure, never as a link that does not exist.
 */
export async function openAgreement(token: string): Promise<AgreementView | null> {
  if (!isAgreementToken(token)) return { state: "missing" };
  const supabase = createAnonClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("pax_link_open", { target_token: token });
  if (error) return null;
  return agreementViewOf(data);
}
