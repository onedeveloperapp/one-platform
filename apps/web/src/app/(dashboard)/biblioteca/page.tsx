import LibraryView, { type LibraryState } from "./library-view";

// A document sent for a model is read after the response where there are no jobs (0067): the transcription of a
// PDF is a model writing the whole text back, which takes the time a step of the jobs has.
export const maxDuration = 300;

import { loadLibrary } from "@/lib/library/facts";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * /biblioteca: the firm's verified library and its models of pieces
 * (migration 0029), read under the person's own session: row-level security
 * shows the sources and the models of their firm only. A piece of the firm
 * is approved only when every source it cites is here, so this is where a
 * lawyer says "I checked this one at its source".
 */
async function loadState(): Promise<LibraryState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  try {
    const [data, supportVisit] = await Promise.all([
      loadLibrary(context.supabase, context.firm.id, context.profile.timezone),
      isSupportVisit(),
    ]);
    const role = context.firm.firmFunction;
    return {
      kind: "ready",
      data,
      // Who says a source was checked, and who writes the firm's models: who signs. Never a support visit.
      mayWrite: !supportVisit && (role === "socio" || role === "advogado"),
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ fonte?: string | string[] }> }) {
  // A source somebody came to register from a piece that cites it (the case sends its name, never a
  // person's data): the dialog that adds a source opens on it.
  const { fonte } = await searchParams;
  const citation = typeof fonte === "string" ? fonte.trim().slice(0, 300) : "";
  return <LibraryView state={await loadState()} citation={citation || null} />;
}
