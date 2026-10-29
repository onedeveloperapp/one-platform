import { createHash, randomBytes } from "node:crypto";

import { memberUrl } from "@/lib/messages/format";
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
 * `POST /api/parceiros/v1/links`: the agency's system issues the link of an adult passenger it names by CPF, for the
 * system to send them (migration 0073, `pax_api_issue_link`). The link is answered once; a new one ends the one the
 * passenger had.
 */
export async function POST(request: Request) {
  const key = keyOf(request);
  if (!key) return refused("missing_key");
  const cpf = cpfOf((await bodyOf(request))?.cpf);
  if (!cpf) return refused("invalid_body");
  const backend = backendOrNull();
  if (!backend) return refused("unavailable");
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await backend.rpc("pax_api_issue_link", {
    target_key_hash: hashApiKey(key),
    target_cpf: cpf,
    target_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
  });
  if (error) return refused("failed");
  const answer = (data ?? {}) as Record<string, unknown>;
  if (!answer.ok) return refused(String(answer.code ?? "failed"));
  return answered({ link: memberUrl(`/acordo/${token}`), valido_ate: answer.expires_at ?? null });
}
