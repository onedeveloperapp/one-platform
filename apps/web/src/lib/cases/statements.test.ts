import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TASK_OUTPUT_KEYS } from "@/lib/admin/ai";
import {
  answerDueOn,
  CERTIFICATE_KIND_KEY,
  CERTIFICATE_KINDS,
  certificateExpiry,
  CHANNEL_KEY,
  CHANNEL_URL,
  CHRONOLOGY_STATUSES,
  CHRONOLOGY_TASK,
  chronologyBriefing,
  chronologyLines,
  chronologyShown,
  COMPLAINT_CHANNELS,
  COMPLAINT_OUTCOMES,
  complaintOverdue,
  COURT_SYSTEMS,
  isPassingStatementFailure,
  OUTCOME_KEY,
  STAGE_KEY,
  STATEMENT_AUDIO_MIMES,
  statementAudioMime,
  statementErrorKey,
  statementStage,
  type StatementView,
  STATION_CHECK_KEY,
  stationChecks,
  TRANSCRIPTION_TASK,
} from "@/lib/cases/statements";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0026_statements.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The values a check constraint of migration 0026 allows, in its order. */
function allowed(constraint: string): string[] {
  const start = MIGRATION.indexOf(`constraint ${constraint} check`);
  expect(start, constraint).toBeGreaterThan(-1);
  const list = /in \(([^)]+)\)/.exec(MIGRATION.slice(start));
  return [...(list?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

const statement = (over: Partial<StatementView> = {}): StatementView => ({
  uploading: false,
  transcript: null,
  work: null,
  transcriptWaits: false,
  chronologyStatus: "none",
  ...over,
});

describe("what the code says matches what the database keeps", () => {
  it("lists the same values as the check constraints", () => {
    expect([...CHRONOLOGY_STATUSES]).toEqual(allowed("case_statements_chronology_check"));
    expect([...COMPLAINT_CHANNELS]).toEqual(allowed("admin_complaints_channel_check"));
    expect([...COMPLAINT_OUTCOMES]).toEqual(allowed("admin_complaints_outcome_check"));
    expect([...COURT_SYSTEMS]).toEqual(allowed("certificate_inventory_system_check"));
    expect([...CERTIFICATE_KINDS]).toEqual(allowed("certificate_inventory_kind_check"));
  });

  it("reserves an audio under the types the setting of the purpose opens", () => {
    const setting = /'mimes', jsonb_build_array\(([^)]+)\)/.exec(MIGRATION);
    const mimes = [...(setting?.[1] ?? "").matchAll(/'([a-z0-9/]+)'/g)].map((match) => match[1]);
    expect([...STATEMENT_AUDIO_MIMES]).toEqual(mimes);
  });

  it("names the two tasks as the migration seeds them, with the fields the code reads", () => {
    expect(MIGRATION).toContain(`'${TRANSCRIPTION_TASK}'`);
    expect(MIGRATION).toContain(`'${CHRONOLOGY_TASK}'`);
    expect(TASK_OUTPUT_KEYS[TRANSCRIPTION_TASK]).toEqual(["texto"]);
    expect(TASK_OUTPUT_KEYS[CHRONOLOGY_TASK]).toEqual(["cronologia", "perguntas"]);
    for (const key of ["texto", "cronologia", "perguntas"]) expect(MIGRATION).toContain(`"${key}"`);
    // What the database reads of each answer.
    expect(MIGRATION).toContain("run.output ->> 'texto'");
    expect(MIGRATION).toContain("run.output ->> 'cronologia'");
  });

  it("has words for every stage, channel, outcome and kind", () => {
    const keys = [
      ...Object.values(STAGE_KEY),
      ...Object.values(CHANNEL_KEY),
      ...Object.values(OUTCOME_KEY),
      ...Object.values(CERTIFICATE_KIND_KEY),
      statementErrorKey("type_not_allowed"),
      statementErrorKey("statement_limit"),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
    expect(statementErrorKey("type_not_allowed")).toBe("case-error-audio-type");
    expect(statementErrorKey("statement_limit")).toBe("case-error-statement-limit");
  });
});

describe("the type an audio is reserved under", () => {
  it("lets the extension speak before the browser", () => {
    expect(statementAudioMime({ name: "relato.m4a", type: "audio/x-m4a" })).toBe("audio/mp4");
    expect(statementAudioMime({ name: "PTT-20260920-WA0001.opus", type: "" })).toBe("audio/ogg");
    expect(statementAudioMime({ name: "Gravação.MP3", type: "audio/mp3" })).toBe("audio/mpeg");
    expect(statementAudioMime({ name: "voz.aac", type: "audio/vnd.dlna.adts" })).toBe("audio/aac");
  });

  it("falls back to the browser's word, and to a type no purpose opens when there is none", () => {
    expect(statementAudioMime({ name: "relato", type: "audio/ogg; codecs=opus" })).toBe("audio/ogg");
    expect(statementAudioMime({ name: "relato", type: "audio/x-m4a" })).toBe("audio/mp4");
    expect(statementAudioMime({ name: "contrato.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(statementAudioMime({ name: "sem-tipo", type: "" })).toBe("application/octet-stream");
    for (const mime of ["application/pdf", "application/octet-stream"]) {
      expect(STATEMENT_AUDIO_MIMES).not.toContain(mime);
    }
  });
});

describe("what the model reads to propose a chronology", () => {
  const trip = { incident: "delay", airline: "Gol", flightDate: "2026-09-20" };

  it("gives what the case registers, then the account", () => {
    const briefing = chronologyBriefing(trip, "  Cheguei às oito e o voo saiu às quatro.  ");
    expect(briefing).toContain("O que o caso registra: atraso de voo, companhia Gol, voo em 20/09/2026.");
    expect(briefing.endsWith("Cheguei às oito e o voo saiu às quatro.")).toBe(true);
    expect(briefing).not.toContain("Cronologia anterior");
  });

  it("says so when the case registers nothing of the trip", () => {
    expect(chronologyBriefing({ incident: null, airline: null, flightDate: null }, "Relato.")).toContain(
      "O caso ainda não registra dados da viagem.",
    );
  });

  it("carries the chronology the client contested and what they said of it", () => {
    const briefing = chronologyBriefing(trip, "Relato.", {
      chronology: "20/09/2026, 16:00: o voo saiu.",
      clientNote: "O voo saiu às 17h.",
    });
    expect(briefing).toContain("Cronologia anterior, que o cliente disse estar errada:");
    expect(briefing).toContain("20/09/2026, 16:00: o voo saiu.");
    expect(briefing.endsWith("O voo saiu às 17h.")).toBe(true);
    // Without the client's word there is nothing to answer: an old chronology alone is not sent.
    expect(chronologyBriefing(trip, "Relato.", { chronology: "x", clientNote: null })).not.toContain("x");
  });

  it("carries the proposal the firm sent back and what it asked to change in it", () => {
    const briefing = chronologyBriefing(trip, "Relato.", null, {
      proposal: "20/09/2026: o voo atrasou cinco horas.",
      firmNote: "  A data certa é 21/09/2026, conferi no bilhete.  ",
    });
    expect(briefing).toContain("Proposta anterior sua, que o escritório devolveu:");
    expect(briefing).toContain("20/09/2026: o voo atrasou cinco horas.");
    expect(briefing).toContain("O que o escritório pediu para mudar nela");
    expect(briefing.endsWith("A data certa é 21/09/2026, conferi no bilhete.")).toBe(true);
    // The client's word comes before the firm's when both are there: each answers what came before it.
    const both = chronologyBriefing(
      trip,
      "Relato.",
      { chronology: "20/09/2026, 16:00: o voo saiu.", clientNote: "O voo saiu às 17h." },
      { proposal: "20/09/2026, 17:00: o voo saiu.", firmNote: "Escreva o aeroporto de saída." },
    );
    expect(both.indexOf("O voo saiu às 17h.")).toBeLessThan(both.indexOf("Escreva o aeroporto de saída."));
    // Without the firm's words there is nothing to answer: a proposal alone is not sent.
    expect(chronologyBriefing(trip, "Relato.", null, { proposal: "x", firmNote: null })).not.toContain("x");
  });
});

describe("where a statement stands", () => {
  it("follows the audio until it is text", () => {
    expect(statementStage(statement({ uploading: true }))).toBe("uploading");
    expect(statementStage(statement({ work: "transcribe" }))).toBe("transcribing");
    expect(statementStage(statement({ transcriptWaits: true }))).toBe("transcript_waits");
    expect(statementStage(statement())).toBe("not_transcribed");
  });

  it("follows the chronology from the proposal to the client's answer", () => {
    const told = { transcript: "Relato." };
    expect(statementStage(statement({ ...told, work: "chronology" }))).toBe("proposing");
    expect(statementStage(statement({ ...told }))).toBe("not_proposed");
    expect(statementStage(statement({ ...told, chronologyStatus: "dismissed" }))).toBe("not_proposed");
    expect(statementStage(statement({ ...told, chronologyStatus: "proposed" }))).toBe("waiting_firm");
    expect(statementStage(statement({ ...told, chronologyStatus: "approved" }))).toBe("waiting_client");
    expect(statementStage(statement({ ...told, chronologyStatus: "confirmed" }))).toBe("confirmed");
    expect(statementStage(statement({ ...told, chronologyStatus: "contested" }))).toBe("contested");
  });

  it("shows only a chronology somebody approved, and splits it into its facts", () => {
    expect(CHRONOLOGY_STATUSES.filter(chronologyShown)).toEqual(["approved", "confirmed", "contested"]);
    expect(chronologyLines("  08:00: chegou.\r\n\r\n16:00: o voo saiu.  \n")).toEqual([
      "08:00: chegou.",
      "16:00: o voo saiu.",
    ]);
    expect(chronologyLines(null)).toEqual([]);
  });

  it("tries again only what may pass by itself", () => {
    expect(isPassingStatementFailure("provider_unavailable")).toBe(true);
    expect(isPassingStatementFailure("run_failed")).toBe(true);
    expect(isPassingStatementFailure("audio_too_large")).toBe(false);
    expect(isPassingStatementFailure("provider_cannot_read_audio")).toBe(false);
  });
});

describe("the administrative complaint", () => {
  it("proposes the day an answer is due from the channel's own days", () => {
    expect(answerDueOn("2026-10-01", 10)).toBe("2026-10-11");
    expect(answerDueOn("2026-12-28", 10)).toBe("2027-01-07");
    expect(answerDueOn(null, 10)).toBeNull();
    expect(answerDueOn("2026-10-01", undefined)).toBeNull();
    expect(answerDueOn("01/10/2026", 10)).toBeNull();
  });

  it("is overdue only while it waits past its day", () => {
    expect(complaintOverdue({ outcome: "pending", answerDueOn: "2026-10-11" }, "2026-10-12")).toBe(true);
    expect(complaintOverdue({ outcome: "pending", answerDueOn: "2026-10-11" }, "2026-10-11")).toBe(false);
    expect(complaintOverdue({ outcome: "answered", answerDueOn: "2026-10-11" }, "2026-10-12")).toBe(false);
    expect(complaintOverdue({ outcome: "pending", answerDueOn: null }, "2026-10-12")).toBe(false);
  });

  it("sends the client to the channel's own address, over https", () => {
    for (const url of Object.values(CHANNEL_URL))
      expect(url).toMatch(/^https:\/\/www\.(?:[a-z]+\.)?gov\.br(?:\/[a-z]+)?$/);
  });
});

describe("the certificate inventory", () => {
  it("warns of a validity that is over or close", () => {
    expect(certificateExpiry(null, "2026-10-09")).toBe("unknown");
    expect(certificateExpiry("2026-10-08", "2026-10-09")).toBe("expired");
    expect(certificateExpiry("2026-10-09", "2026-10-09")).toBe("soon");
    expect(certificateExpiry("2026-11-08", "2026-10-09")).toBe("soon");
    expect(certificateExpiry("2026-11-09", "2026-10-09")).toBe("ok");
  });

  it("asks of each system what its filing station needs, and of PJe its authenticator too", () => {
    expect(stationChecks("projudi")).toEqual(["access", "signer", "validity"]);
    expect(stationChecks("pje")).toEqual(["access", "signer", "validity", "authenticator"]);
    for (const system of COURT_SYSTEMS) {
      for (const check of stationChecks(system)) expect(product[STATION_CHECK_KEY[check]], check).toBeTruthy();
    }
  });

  it("keeps nothing of a certificate itself", () => {
    const table = /create table public\.certificate_inventory \(([\s\S]*?)\n\);/.exec(MIGRATION)?.[1] ?? "";
    const columns = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|text|date|timestamptz)/gm)].map((match) => match[1]);
    expect(columns).toEqual([
      "id",
      "org_id",
      "user_id",
      "system",
      "kind",
      "issuer",
      "valid_until",
      "station_checked_at",
      "created_at",
      "updated_at",
    ]);
  });
});
