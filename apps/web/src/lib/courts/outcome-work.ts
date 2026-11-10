import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { plainText } from "@/lib/publications/publications";
import { createServiceClient } from "@flyee/auth/service";
import { certifiesFinal, movementFact, readJudgment, readRelease } from "@flyee/rules/outcome";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE reads what each lawsuit came to (phase 6, migration 0130): every movement of the court not read yet is read by
 * the rule `resultado-v1` (`@flyee/rules/outcome`), and every publication the firm's triage says is the judgment, or a
 * payment, is read for its result and its value, and every other publication for the certificate that the judgment
 * became final (0142); what the rule reads is recorded by the database as a fact of the
 * lawsuit, as ONE's (or waiting for a person where the firm keeps the result to a person). Then the cases ready are
 * closed by ONE where the firm lets it. Only ids and the rule's reading leave this file; the court's words the fact
 * keeps are the court's.
 */

const BATCH = 200;

/** What the rule reads of a movement, in the database's words: a fact, or null. */
function movementReading(title: string, detail: string | null): Record<string, unknown> | null {
  const fact = movementFact(title, detail);
  if (!fact) return null;
  switch (fact.kind) {
    case "sentenca":
      return { kind: "sentenca", result: fact.result };
    case "recurso":
      return fact.by ? { kind: "recurso", appeal_by: fact.by } : null;
    case "alvara":
      return { kind: "alvara", release_kind: fact.release };
    default:
      return { kind: fact.kind };
  }
}

/** What the rule reads of a publication: the judgment's result and value, a settlement, or a release's value. */
function publicationReading(category: string, body: string): Record<string, unknown> | null {
  if (category === "pagamento") {
    const release = readRelease(body);
    return release
      ? { kind: "alvara", release_kind: release.release, cents: String(release.cents), words: body.slice(0, 600) }
      : null;
  }
  const judgment = readJudgment(body);
  if (!judgment) return null;
  return judgment.result === "acordo"
    ? { kind: "acordo", cents: judgment.cents ? String(judgment.cents) : "", words: judgment.words }
    : {
        kind: "sentenca",
        result: judgment.result,
        cents: judgment.cents ? String(judgment.cents) : "",
        per_claimant: judgment.perClaimant,
        words: judgment.words,
      };
}

/** A round of the reading: movements, then publications, then the cases ready to close. Counts only. */
export async function outcomesRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts = { movements: 0, publications: 0, recorded: 0, closed: 0 };
  while (Date.now() < until) {
    const { data, error } = await service
      .from("movements")
      .select("id, title, detail")
      .is("outcome_read_at", null)
      .order("learned_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`movements to read failed: ${error.code ?? "unknown"}`);
    const rows = (data ?? []) as { id: string; title: string; detail: string | null }[];
    for (const row of rows) {
      const { data: answer, error: recordError } = await service.rpc("record_movement_outcome", {
        target_movement: row.id,
        target_reading: movementReading(row.title, row.detail),
      });
      if (recordError) throw new Error(`record_movement_outcome failed: ${recordError.code ?? "unknown"}`);
      counts.movements += 1;
      if ((answer as { code?: string } | null)?.code === "recorded") counts.recorded += 1;
    }
    if (rows.length < BATCH) break;
  }
  // The judgments a person or ONE's triage said are the judgment, then the payments.
  for (const kind of ["decisao", "pagamento"] as const) {
    while (Date.now() < until) {
      let query = service
        .from("publications")
        .select("id, category, body")
        .is("outcome_read_at", null)
        .eq("category", kind);
      if (kind === "decisao") query = query.eq("judgment", true);
      const { data, error } = await query.order("captured_at", { ascending: true }).limit(BATCH);
      if (error) throw new Error(`publications to read failed: ${error.code ?? "unknown"}`);
      const rows = (data ?? []) as { id: string; category: string; body: string | null }[];
      for (const row of rows) {
        const { data: answer, error: recordError } = await service.rpc("record_publication_outcome", {
          target_publication: row.id,
          target_reading: publicationReading(row.category, row.body ?? ""),
        });
        if (recordError) throw new Error(`record_publication_outcome failed: ${recordError.code ?? "unknown"}`);
        counts.publications += 1;
        const code = (answer as { code?: string } | null)?.code;
        if (code === "recorded" || code === "completed") counts.recorded += 1;
      }
      if (rows.length < BATCH) break;
    }
  }
  // The court's certificate that the judgment became final, published apart from it and triaged as anything but the
  // judgment or a payment (0142): each triaged publication read once more, for that alone.
  while (Date.now() < until) {
    const { data, error } = await service
      .from("publications")
      .select("id, category, judgment, body")
      .is("final_read_at", null)
      .not("category", "is", null)
      .order("captured_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`publications to read for the trânsito failed: ${error.code ?? "unknown"}`);
    const rows = (data ?? []) as { id: string; category: string; judgment: boolean | null; body: string | null }[];
    for (const row of rows) {
      const read = row.category !== "pagamento" && !(row.category === "decisao" && row.judgment === true);
      const text = read ? plainText(row.body ?? "") : "";
      const { data: answer, error: recordError } = await service.rpc("record_publication_final", {
        target_publication: row.id,
        target_final: read && certifiesFinal(text),
        target_words: read ? text.slice(0, 600) : null,
      });
      if (recordError) throw new Error(`record_publication_final failed: ${recordError.code ?? "unknown"}`);
      counts.publications += 1;
      if ((answer as { code?: string } | null)?.code === "recorded") counts.recorded += 1;
    }
    if (rows.length < BATCH) break;
  }
  const { data: closed, error: closeError } = await service.rpc("close_cases_by_one", { target_limit: 50 });
  if (closeError) throw new Error(`close_cases_by_one failed: ${closeError.code ?? "unknown"}`);
  counts.closed = Number(closed ?? 0);
  return counts;
}

/** Right after the court moved (a reading, the test court): ONE reads it, never waited for by the person. */
export function queueOutcomes(): void {
  soon("lawsuit-outcomes", async () => {
    await outcomesRound(createServiceClient(), Date.now() + 60_000);
  });
}

export const outcomeSweeps: Sweep[] = [
  {
    // Also while ONE is used: each movement and publication is read once by the database's own mark.
    key: "lawsuit-outcomes",
    when: { every: 10 },
    whileUsed: true,
    run: (service, until) => outcomesRound(service, until),
  },
];
