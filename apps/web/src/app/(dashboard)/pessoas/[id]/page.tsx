import PersonView, { type PersonState } from "./person-view";
import { notFound } from "next/navigation";

import { getMemberContext } from "@/lib/member/context";
import { loadPerson } from "@/lib/people/read";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page of a person of the firm (migration 0133), read under the person's own session. */
async function loadState(id: string): Promise<PersonState | null> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  try {
    const [page, assurance] = await Promise.all([
      loadPerson(context.supabase, context.firm.id, id),
      context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (!page) return null;
    return {
      kind: "ready",
      id,
      page,
      factor:
        assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing",
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const state = await loadState(id);
  if (!state) notFound();
  return <PersonView state={state} />;
}
