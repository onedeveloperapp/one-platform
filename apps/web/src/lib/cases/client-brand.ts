import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import { createAnonClient } from "@/lib/public-content";
import { createServiceClient } from "@flyee/auth/service";
import { drawsOnLight } from "@flyee/documents/brand";

/**
 * The firm's brand on its client's page (migration 0261, the plan "o escritório preparado antes do primeiro
 * atendimento", phase 2): the firm's logo, by a short link the backend makes to ONE's PNG of it, and its colour where
 * it reads on white (3:1, for icons and bars; the words keep the text's colours). Nothing of the platform's: a link
 * whose firm gave neither reads none, and the page keeps its own look.
 */

export type ClientBrand = { logoUrl: string | null; color: string | null };

const NONE: ClientBrand = { logoUrl: null, color: null };

/** How long the logo's link works: the page draws it at once. */
const LOGO_SECONDS = 600;

export async function readClientBrand(token: string): Promise<ClientBrand> {
  const anon = createAnonClient();
  if (!anon) return NONE;
  const { data, error } = await anon.rpc("client_link_brand", { target_token: token });
  const answer = (error ? null : data) as { ok?: boolean; logo_file_id?: string | null; color?: string | null } | null;
  if (!answer?.ok) return NONE;
  const color = typeof answer.color === "string" && drawsOnLight(answer.color) ? answer.color : null;
  if (!answer.logo_file_id) return { logoUrl: null, color };
  try {
    const service = createServiceClient();
    const { data: file } = await service
      .from("files")
      .select("storage_path")
      .eq("id", answer.logo_file_id)
      .eq("status", "stored")
      .maybeSingle();
    if (!file?.storage_path) return { logoUrl: null, color };
    const { data: signed } = await service.storage
      .from(FIRM_FILES_BUCKET)
      .createSignedUrl(String(file.storage_path), LOGO_SECONDS);
    return { logoUrl: signed?.signedUrl ?? null, color };
  } catch {
    return { logoUrl: null, color };
  }
}
