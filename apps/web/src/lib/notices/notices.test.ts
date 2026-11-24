import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  blockerKey,
  isNoticeKind,
  isUnconfirmed,
  KIND_KEY,
  KIND_STATE_KEY,
  kindState,
  NOTICE_KINDS,
  noticeErrorKey,
  noticeTextFindings,
  noticeTextProblem,
  paramKey,
  pendingState,
  sentKey,
} from "@/lib/notices/notices";
import messages from "@flyee/content/messages/pt-BR.json";
import { renderTemplate } from "@flyee/whatsapp/rules";

const ROOT = path.resolve(__dirname, "../../../../..");
// The kinds were made in 0038, one more joined in 0047 (ONE's first word when a flight has a problem), two in
// 0055 (what the client sent arrived, and the lawsuit was filed), one in 0095 (the interview asks to go on) and two
// in 0173 (the day of a trip: a good trip, and how it went), the passenger's welcome in 0174, and two in 0188 (to who
// goes to a hearing: its brief, and its result), one in 0248 (the client told what came of their hearing), and one in
// 0269 (to the lawyers of a lawsuit whose package waits to be filed).
const MIGRATION = [
  "0038_client_notices.sql",
  "0047_test_chat.sql",
  "0055_client_progress.sql",
  "0095_case_interview.sql",
  "0173_trip_day.sql",
  "0174_passenger_welcome.sql",
  "0188_hearing_staff_messages.sql",
  "0248_hearing_outcome_notice.sql",
  "0269_filing_by_hand.sql",
]
  .map((file) => fs.readFileSync(path.join(ROOT, "packages/db/migrations", file), "utf8"))
  .join("\n");
const product = messages.product as Record<string, string>;

/** The kinds the migration seeds, each with its text, footer, values and examples. */
function seeded(): { kind: string; body: string; footer: string; params: string[]; examples: string[] }[] {
  const blocks: string[] = [];
  for (let start = MIGRATION.indexOf("insert into public.notice_kinds"); start >= 0; ) {
    blocks.push(MIGRATION.slice(start, MIGRATION.indexOf("on conflict (kind) do nothing", start)));
    start = MIGRATION.indexOf("insert into public.notice_kinds", start + 1);
  }
  // Each row starts on its own line: ('kind', position, 'base', 'text', 'footer', array[...], array[...]).
  const rows = blocks.flatMap((block) => block.split(/\n {2}\(/).slice(1));
  return rows.map((row) => {
    const strings = [...row.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1].replaceAll("''", "'"));
    const arrays = [...row.matchAll(/array\[([\s\S]*?)\]/g)].map((match) =>
      [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((value) => value[1].replaceAll("''", "'")),
    );
    return { kind: strings[0], body: strings[2], footer: strings[3], params: arrays[0], examples: arrays[1] };
  });
}

describe("what the code says matches what the database keeps", () => {
  it("lists the kinds as the table allows them, and the migration seeds each one", () => {
    // The latest definition of the check is the one in force.
    const check =
      [...MIGRATION.matchAll(/constraint notice_kinds_kind_check check \(kind in \(([^)]+)\)\)/g)].pop()?.[1] ?? "";
    const allowed = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect([...NOTICE_KINDS].sort()).toEqual(allowed.sort());
    expect(
      seeded()
        .map((row) => row.kind)
        .sort(),
    ).toEqual([...NOTICE_KINDS].sort());
    expect(isNoticeKind("hearing_reminder")).toBe(true);
    expect(isNoticeKind("marketing")).toBe(false);
  });

  it("proposes texts the firm may submit as they are, plain and with nothing a lawyer is asked to weigh", () => {
    for (const row of seeded()) {
      expect(noticeTextProblem(row.body, row.params.length), row.kind).toBeNull();
      expect(row.params.length, row.kind).toBe(row.examples.length);
      expect(noticeTextFindings(row.body, row.footer), row.kind).toEqual([]);
      // As a client reads it: every value filled, no mark of the product's copy rules.
      const read = renderTemplate(row.body, row.examples);
      expect(read, row.kind).not.toMatch(/\{\{|[—–!]/);
      for (const param of row.params) expect(product[paramKey(param)], param).toBeTruthy();
    }
  });
});

describe("a firm's own text of a kind", () => {
  it("keeps the kind's values, each once and in order, and neither starts nor ends with one", () => {
    expect(noticeTextProblem("Olá, {{1}}. Aviso do escritório {{2}}.", 2)).toBeNull();
    expect(noticeTextProblem("curto", 0)).toBe("invalid_body");
    expect(noticeTextProblem("Olá, {{2}}. Aviso do escritório {{1}}.", 2)).toBe("invalid_values");
    expect(noticeTextProblem("Olá, {{1}}. Aviso do escritório sem o nome.", 2)).toBe("invalid_values");
    expect(noticeTextProblem("Olá, {{1}}. Aviso do escritório {{2}} e {{2}}.", 2)).toBe("invalid_values");
    expect(noticeTextProblem("{{1}}, aviso do escritório {{2}} sobre o processo.", 2)).toBe("value_at_edge");
    expect(noticeTextProblem("Aviso a {{1}} do escritório sobre o processo {{2}}", 2)).toBe("value_at_edge");
    expect(noticeTextProblem(`Olá, {{1}}. ${"a".repeat(1100)}`, 1)).toBe("invalid_body");
  });

  it("points at what speaks of a result or a price, and refuses nothing for it", () => {
    expect(noticeTextFindings("Olá, {{1}}. Garantimos a sua indenização, sem custo.", "Responda SAIR.")).toContain(
      "speaks_of_price",
    );
  });
});

describe("how a kind stands for the firm", () => {
  it("goes from no text, to waiting, to approved and off, to on; a refused or a marketing one says so", () => {
    expect(kindState({ enabled: false, template: null })).toBe("none");
    expect(kindState({ enabled: false, template: { status: "pending", category: "utility" } })).toBe("pending");
    expect(kindState({ enabled: false, template: { status: "approved", category: "utility" } })).toBe("ready");
    expect(kindState({ enabled: true, template: { status: "approved", category: "utility" } })).toBe("on");
    expect(kindState({ enabled: true, template: { status: "approved", category: "marketing" } })).toBe("not_utility");
    expect(kindState({ enabled: false, template: { status: "rejected", category: "utility" } })).toBe("refused");
    expect(kindState({ enabled: false, template: { status: "disabled", category: "utility" } })).toBe("refused");
    expect(kindState({ enabled: true, template: { status: "paused", category: "utility" } })).toBe("paused");
  });

  it("says what became of a new text at the vendor while the one before goes on", () => {
    expect(pendingState(null)).toBeNull();
    expect(pendingState({ status: "pending", category: "utility" })).toBe("notices-pending-waiting");
    expect(pendingState({ status: "rejected", category: "utility" })).toBe("notices-pending-refused");
    expect(pendingState({ status: "approved", category: "marketing" })).toBe("notices-pending-not-utility");
  });

  it("says a message whose fate nobody knows apart from one that did not go out", () => {
    expect(isUnconfirmed("failed", "unconfirmed")).toBe(true);
    expect(isUnconfirmed("failed", "rate_limited")).toBe(false);
    expect(isUnconfirmed("delivered", null)).toBe(false);
  });
});

describe("the words", () => {
  it("has words for every kind, state, reason, message state, value and refusal", () => {
    const keys = [
      ...Object.values(KIND_KEY).flatMap((kind) => [kind.label, kind.when]),
      ...Object.values(KIND_STATE_KEY),
      ...[
        "no_phone",
        "opted_out",
        "stopped",
        "kind_off",
        "template_unusable",
        "no_number",
        "number_failing",
        "anything",
        null,
      ].map(blockerKey),
      ...["notices-pending-waiting", "notices-pending-refused", "notices-pending-not-utility"],
      ...["queued", "sending", "sent", "delivered", "read", "failed", "anything", null].map(sentKey),
      ...["first_name", "firm", "hearing", "lawsuit", "moment", "how", "change", "status", "anything"].map(paramKey),
      ...[
        "invalid_body",
        "invalid_values",
        "value_at_edge",
        "no_number",
        "several_accounts",
        "no_template",
        "template_not_approved",
        "template_not_utility",
        "note_required",
        "no_phone",
        "person_not_found",
        "second_factor_required",
        "not_allowed_in_support_session",
        "not_authorized",
        "unconfirmed",
        "rejected",
        "name_taken",
        "number_failing",
        "meta_131000",
        "anything else",
        null,
      ].map(noticeErrorKey),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
    expect(noticeErrorKey("meta_100")).toBe("notice-error-refused");
    // A token the vendor no longer takes is the connection's, never the text's.
    expect(noticeErrorKey("meta_190")).toBe("notice-blocker-number-failing");
    expect(noticeErrorKey("vault_not_configured")).toBe("notice-error-failed");
  });
});
