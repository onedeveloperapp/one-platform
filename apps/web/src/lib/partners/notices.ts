import "server-only";

import { notifyLocalized } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The bell of the two sides of a partnership (migration 0069), each notice written once by its key: who manages
 * the firm is told when the agency accepted its invitation and when the agency ended the partnership, and who
 * manages the agency when the firm ended it. Written after the database recorded the change, and best effort: a
 * notice that could not be written changes nothing of the partnership, whose screens say where it stands.
 */

type Link = { id: string; orgId: string; partnerId: string; firm: string; partner: string };

const name = (value: unknown): string => {
  const row = (Array.isArray(value) ? value[0] : value) as { name?: unknown } | null | undefined;
  return typeof row?.name === "string" ? row.name : "";
};

async function linkOf(service: SupabaseClient, linkId: string): Promise<Link | null> {
  const { data, error } = await service
    .from("partner_links")
    .select("id, org_id, partner_id, organizations(name), partners(name)")
    .eq("id", linkId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    partnerId: String(row.partner_id),
    firm: name(row.organizations),
    partner: name(row.partners),
  };
}

/** The owner and the admins of the firm, or of the partner: who a partnership is managed by. */
async function managersOf(service: SupabaseClient, side: "firm" | "partner", id: string): Promise<string[]> {
  const { data, error } =
    side === "firm"
      ? await service.from("memberships").select("user_id").eq("org_id", id).in("role", ["owner", "admin"])
      : await service.from("partner_members").select("user_id").eq("partner_id", id).in("role", ["owner", "admin"]);
  if (error) return [];
  return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
}

const ready = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Who manages the firm learns that the agency accepted its invitation, and where to follow the partnership. */
export async function tellPartnerJoined(linkId: string): Promise<void> {
  if (!ready()) return;
  try {
    const service = createServiceClient();
    const link = await linkOf(service, linkId);
    if (!link) return;
    await notifyLocalized(await managersOf(service, "firm", link.orgId), (copy) => copy.partnerJoined(link.partner), {
      type: "team",
      href: "/settings/parceiros",
      sourceKey: `partner-joined:${link.id}`,
    });
  } catch {
    // Best effort: the partnership is recorded, and its screen says so.
  }
}

/** The other side learns that the partnership ended: the firm's managers when the agency ended it, and back. */
export async function tellPartnershipEnded(linkId: string, by: "firm" | "partner"): Promise<void> {
  if (!ready()) return;
  try {
    const service = createServiceClient();
    const link = await linkOf(service, linkId);
    if (!link) return;
    if (by === "partner") {
      await notifyLocalized(
        await managersOf(service, "firm", link.orgId),
        (copy) => copy.partnerEndedByPartner(link.partner),
        { type: "team", href: "/settings/parceiros", sourceKey: `partner-ended:${link.id}` },
      );
    } else {
      await notifyLocalized(
        await managersOf(service, "partner", link.partnerId),
        (copy) => copy.partnerEndedByFirm(link.firm),
        { type: "team", href: "/parceiro", sourceKey: `partner-ended:${link.id}` },
      );
    }
  } catch {
    // Best effort, as above.
  }
}
