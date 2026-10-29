import {
  answered,
  backendOrNull,
  bodyOf,
  cpfOf,
  hashApiKey,
  keyOf,
  refused,
} from "@/modules/direito-do-passageiro/agency/api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/parceiros/v1/situacao`: where a passenger the agency's system names by CPF stands (migration 0073,
 * `pax_api_status`): whether they agreed, whether their link is open, whether they went to the firm, and what ONE
 * does of each of their trips. A POST, so a CPF never goes in the address.
 */
export async function POST(request: Request) {
  const key = keyOf(request);
  if (!key) return refused("missing_key");
  const cpf = cpfOf((await bodyOf(request))?.cpf);
  if (!cpf) return refused("invalid_body");
  const backend = backendOrNull();
  if (!backend) return refused("unavailable");
  const { data, error } = await backend.rpc("pax_api_status", { target_key_hash: hashApiKey(key), target_cpf: cpf });
  if (error) return refused("failed");
  const answer = (data ?? {}) as Record<string, unknown>;
  if (!answer.ok) return refused(String(answer.code ?? "failed"));
  return answered({
    acordo: answer.acordo ?? "sem_resposta",
    link_aberto: answer.link_aberto === true,
    com_o_escritorio: answer.com_o_escritorio === true,
    viagens: Array.isArray(answer.viagens) ? answer.viagens : [],
  });
}
