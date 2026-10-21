// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { countDeadlines } from "@/lib/deadlines/count-work";
import { readCount } from "@/lib/deadlines/deadlines";
import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { composeCnj } from "@flyee/rules/cnj";

/**
 * A firm's deadline, with the app's own worker against a real database: a
 * person proposes it from a publication of the DJEN, the worker counts it
 * with the rule over TJGO's calendar of 2026 (as the migration seeds it) and
 * records the count for the revision it read; who runs the deadlines
 * confirms it; the operator adds a day to the court's calendar and the
 * worker counts it again, the confirmed day untouched and the change shown;
 * the lawsuit moves to another comarca and the count says the comarca's own
 * days are not on record; a count of a revision that changed meanwhile
 * writes nothing; a reading that fails gives its claim back at once, and a
 * count given up after its tries is asked again by a person. What the rule
 * decides and what the database keeps are two
 * halves written apart: this is where one is proven to be the other's.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm and lawsuit here is invented: the lawsuit is of a year
 * to come.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;

const ANA = "ae700000-0000-4000-8000-000000000001";
const BIA = "ae700000-0000-4000-8000-000000000002";
const OPERATOR = "ae700000-0000-4000-8000-000000000009";
const FIRM = "be700000-0000-4000-8000-00000000000a";
const PUBLICATION = "ce700000-0000-4000-8000-000000000001";
const LAWSUIT = composeCnj({ sequence: 5700101, year: 2099, court: "09", origin: 51 });

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });
const backend = () => clientAs("service_role", { role: "service_role" });

async function deadlineOf(id: string): Promise<Row> {
  const [row] = await sql.unsafe(
    `select status, revision, computed_revision, due_on::text as due_on, computed_due_on::text as computed_due_on,
            confirmed_against::text as confirmed_against, assumptions, explanation, court, count_error,
            count_attempts, count_claimed_at is not null as claimed, coalesce(count_retry_after > now(), false) as waiting,
            public.deadline_needs_review(d) as review, public.deadline_review_reasons(d) as reasons
     from public.deadlines d where id = $1`,
    [id],
  );
  return row;
}

describe.skipIf(!DB_URL)("a deadline, proposed, counted over the court's calendar, confirmed and counted again", () => {
  let lawsuitId = "";
  let deadlineId = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${BIA}', '${OPERATOR}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@prazos-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${BIA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bia@prazos-app.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
             ('${OPERATOR}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operador@prazos-app.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
      update public.profiles set is_superadmin = true where id = '${OPERATOR}';
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-prazos-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'advogado'), ('${FIRM}', '${BIA}', 'member', 'controladoria');
      -- The firm has a person confirm each deadline (0016): what follows is that path. ONE confirming is 0045's.
      insert into public.firm_autonomy (org_id, decision, mode) values ('${FIRM}', 'deadline_confirm', 'approval');
    `);
    const opened = (
      await as(ANA).rpc("create_case", {
        target_org: FIRM,
        target_incident: "delay",
        target_airline: "G3",
        target_flight_date: "2026-01-10",
        target_client: { full_name: "Maria Teste" },
      })
    ).data as Row;
    const saved = (
      await as(ANA).rpc("save_proceeding", {
        target_case: opened.case_id,
        target_proceeding: null,
        target_fields: {
          kind: "juizado",
          court: "TJGO",
          system: "projudi",
          comarca: "Goiânia",
          status: "filed",
          cnj: LAWSUIT,
        },
        target_parties: [opened.party_id],
      })
    ).data as Row;
    lawsuitId = String(saved.proceeding_id);
    // What the DJEN brought on the Friday before Carnival, as the capture keeps it.
    await sql.unsafe(
      `insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id)
       values ($1, $2, 'prazoapp00000001', 'TJGO', $3, date '2026-02-13', 'Intimação', 'Manifeste-se em cinco dias.', $4, $5)`,
      [PUBLICATION, FIRM, LAWSUIT, lawsuitId, opened.case_id],
    );
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      delete from public.court_calendar_days where court = 'TJGO' and label = 'Dia sem expediente inventado';
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${BIA}', '${OPERATOR}');
    `);
    await sql.end({ timeout: 5 });
  });

  it("is counted by the worker as the rule counts it, for the revision it read", async () => {
    const proposed = (
      await as(ANA).rpc("propose_deadline", {
        target_publication: PUBLICATION,
        target_proceeding: null,
        target_title: "Manifestação",
        target_act: "manifestacao",
        target_trigger: "publication",
        target_trigger_on: null,
        target_days: 5,
        target_counting: "business",
      })
    ).data as Row;
    expect(proposed.ok).toBe(true);
    deadlineId = String(proposed.id);

    const report = await countDeadlines(backend() as never, { deadlineId });
    expect(report).toMatchObject({ claimed: 1, counted: 1, failed: 0 });

    const counted = await deadlineOf(deadlineId);
    expect(counted).toMatchObject({
      status: "proposed",
      revision: 1,
      computed_revision: 1,
      due_on: "2026-02-25",
      court: "TJGO",
    });
    // Published on Ash Wednesday, whose business started at noon: the reading that would move the start is said.
    expect(counted.assumptions).toEqual(["partial_start"]);
    const count = readCount(counted.explanation);
    expect(count?.publishedOn).toBe("2026-02-18");
    expect(count?.startsOn).toBe("2026-02-19");
    expect(count?.skipped).toEqual([{ from: "2026-02-16", to: "2026-02-17", reason: "closed", label: "Carnaval" }]);
    expect((counted.explanation as Row).place).toMatchObject({ court: "TJGO", comarca: "Goiânia", system: "projudi" });
  });

  it("is confirmed by who runs the deadlines, and a day of the calendar added later is shown, not applied", async () => {
    const confirmed = (
      await as(BIA).rpc("confirm_deadline", {
        target_deadline: deadlineId,
        target_revision: 1,
        target_due_on: null,
        target_reason: null,
      })
    ).data as Row;
    expect(confirmed.code).toBe("confirmed");

    const added = (
      await as(OPERATOR).rpc("admin_save_calendar_day", {
        target_day_id: null,
        target_court: "TJGO",
        target_day: "2026-02-20",
        target_last_day: null,
        target_kind: "closed",
        target_label: "Dia sem expediente inventado",
        target_proceeding_kinds: [],
        target_systems: [],
        target_comarcas: [],
        target_source_url: null,
      })
    ).data as Row;
    expect(added.ok).toBe(true);
    expect(Number(added.recounted)).toBeGreaterThanOrEqual(1);

    await countDeadlines(backend() as never, { deadlineId });
    const recounted = await deadlineOf(deadlineId);
    expect(recounted).toMatchObject({
      status: "confirmed",
      revision: 2,
      computed_revision: 2,
      due_on: "2026-02-25",
      computed_due_on: "2026-02-26",
      confirmed_against: "2026-02-25",
      review: true,
      reasons: ["count_changed"],
    });

    // A day the operator adds far from it changes nothing of its count.
    const far = (
      await as(OPERATOR).rpc("admin_save_calendar_day", {
        target_day_id: null,
        target_court: "TJGO",
        target_day: "2026-11-30",
        target_last_day: null,
        target_kind: "closed",
        target_label: "Dia sem expediente inventado",
        target_proceeding_kinds: [],
        target_systems: [],
        target_comarcas: [],
        target_source_url: null,
      })
    ).data as Row;
    expect(far.ok).toBe(true);
    expect((await deadlineOf(deadlineId)).revision).toBe(2);
  });

  it("is counted again when its lawsuit moves to a comarca whose own days the calendar does not hold", async () => {
    await as(ANA).rpc("save_proceeding", {
      target_case: (await sql.unsafe(`select case_id from public.proceedings where id = $1`, [lawsuitId]))[0].case_id,
      target_proceeding: lawsuitId,
      target_fields: {
        kind: "juizado",
        court: "TJGO",
        system: "projudi",
        comarca: "Anápolis",
        status: "filed",
        cnj: LAWSUIT,
      },
    });
    const moved = await deadlineOf(deadlineId);
    expect(Number(moved.revision)).toBeGreaterThan(2);
    await countDeadlines(backend() as never, { deadlineId });
    const counted = await deadlineOf(deadlineId);
    expect(counted.computed_revision).toBe(counted.revision);
    // The column keeps the codes, for a list to filter by, in their order; the count keeps them as the rule said them.
    expect(counted.assumptions).toEqual(["local_days_unchecked", "partial_start"]);
    expect(readCount(counted.explanation)?.assumptions.map((assumption) => assumption.code)).toEqual([
      "partial_start",
      "local_days_unchecked",
    ]);
  });

  it("never writes a count of a revision that changed while it was counted", async () => {
    const [claim] =
      ((await backend().rpc("claim_deadline_counts", { target_limit: 1, target_deadline: deadlineId }))
        .data as Row[]) ?? [];
    // Nothing is owed: the count is of the revision in force.
    expect(claim).toBeUndefined();

    const before = await deadlineOf(deadlineId);
    await as(ANA).rpc("update_deadline", {
      target_deadline: deadlineId,
      target_title: "Manifestação",
      target_act: "manifestacao",
      target_trigger: "publication",
      target_trigger_on: null,
      target_days: 6,
      target_counting: "business",
    });
    const claimed = (
      (await backend().rpc("claim_deadline_counts", { target_limit: 1, target_deadline: deadlineId })).data as Row[]
    )[0];
    const read = (
      await backend().rpc("deadline_to_count", {
        target_deadline: deadlineId,
        target_claim: claimed.claim,
      })
    ).data as Row;
    // A person corrects it again while the worker holds what it read.
    await as(ANA).rpc("update_deadline", {
      target_deadline: deadlineId,
      target_title: "Manifestação",
      target_act: "manifestacao",
      target_trigger: "publication",
      target_trigger_on: null,
      target_days: 7,
      target_counting: "business",
    });
    const late = (
      await backend().rpc("record_deadline_count", {
        target_deadline: deadlineId,
        target_claim: claimed.claim,
        target_revision: read.revision,
        target_outcome: "counted",
        target_result: { rule: "prazo-v1" },
        target_code: null,
      })
    ).data as Row;
    expect(late.code).toBe("changed");
    const after = await deadlineOf(deadlineId);
    expect(after.status).toBe("proposed");
    expect(Number(after.revision)).toBe(Number(before.revision) + 2);
    expect(after.computed_revision).not.toBe(after.revision);

    // The next round counts the revision in force: seven business days.
    await countDeadlines(backend() as never, { deadlineId });
    const counted = await deadlineOf(deadlineId);
    expect(counted.computed_revision).toBe(counted.revision);
    expect(readCount(counted.explanation)?.days).toBe(7);
  });

  it("gives a claim back at once when its reading fails, and a count given up is asked again by a person", async () => {
    await as(ANA).rpc("update_deadline", {
      target_deadline: deadlineId,
      target_title: "Manifestação",
      target_act: "manifestacao",
      target_trigger: "publication",
      target_trigger_on: null,
      target_days: 8,
      target_counting: "business",
    });
    // The platform fails to read what the count reads: the deadline's own data is not the cause.
    const failing = {
      rpc: (name: string, args: Record<string, unknown>) =>
        name === "deadline_to_count"
          ? Promise.resolve({ data: null, error: { code: "XX000", message: "connection lost" } })
          : backend().rpc(name, args),
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const report = await countDeadlines(failing as never, { deadlineId });
      expect(report).toMatchObject({ claimed: 1, released: 1, counted: 0 });
      const held = await deadlineOf(deadlineId);
      expect(held).toMatchObject({ claimed: false, count_error: "unfinished", count_attempts: attempt });
      expect(held.waiting).toBe(attempt < 3);
      // The wait is over.
      await sql.unsafe(`update public.deadlines set count_retry_after = null where id = $1`, [deadlineId]);
    }
    // Its tries are spent: no sweep takes it, and the firm is asked to look at it.
    const spent = await countDeadlines(backend() as never, { deadlineId });
    expect(spent.claimed).toBe(0);
    expect((await deadlineOf(deadlineId)).reasons).toEqual(["count_failed"]);

    const retried = (await as(ANA).rpc("retry_deadline_count", { target_deadline: deadlineId })).data as Row;
    expect(retried.code).toBe("retried");
    await countDeadlines(backend() as never, { deadlineId });
    const counted = await deadlineOf(deadlineId);
    expect(counted.computed_revision).toBe(counted.revision);
    expect(counted.reasons).toEqual([]);
    expect(readCount(counted.explanation)?.days).toBe(8);
  });
});
