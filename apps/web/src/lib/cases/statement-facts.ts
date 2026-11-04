import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { type AccountState, accountStateOf, type AccountTopic, isAccountTopic } from "@/lib/cases/account";
import { waIdCandidates } from "@/lib/cases/cases";
import { type InterviewView, interviewViewOf } from "@/lib/cases/interview";
import {
  CHRONOLOGY_STATUSES,
  chronologyShown,
  type ChronologyStatus,
  type ComplaintChannel,
  type ComplaintOutcome,
  isComplaintChannel,
  isComplaintOutcome,
  type StatementView,
} from "@/lib/cases/statements";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the case screen reads of the client's account and of the
 * administrative complaint (migration 0026), under the person's own session:
 * the statements of the case, the audios the case's people sent over
 * WhatsApp that are not a statement yet, the complaints, and the days each
 * channel gives for an answer. A read that fails throws: the page shows an
 * error, never a case with no account.
 */

/** One account of the case, as the screen reads it. */
export type CaseStatement = StatementView & {
  id: string;
  partyId: string | null;
  source: "client" | "firm" | "whatsapp";
  spoken: boolean;
  audioFileId: string | null;
  /** Why the work on it stopped, when it did. */
  workError: string | null;
  /** The chronology a person approved (or the AI of a task that earned it): never a proposal still in the queue. */
  chronology: string | null;
  /** What the client said is wrong in a chronology: of the one shown, or of the one before while another is asked. */
  clientNote: string | null;
  /** The chronology the client contested, while another is proposed and decided. */
  previousChronology: string | null;
  /** What the firm asked to change in a proposal it sent back, while no proposal that read it was decided. */
  firmNote: string | null;
  /** When it reached the case, on the reader's clock. */
  receivedLabel: string;
  /**
   * Its work waits and nobody holds it: it failed for a passing reason and waits to be tried again, its
   * claim ran out, or no job picked it up. A person may ask that it be done now.
   */
  stalled: boolean;
  /** What its order of the facts says the account still lacks (0090), as the setting names the points. */
  missingTopics: AccountTopic[];
  /** The questions the client is asked on their link, one for each point that is missing. */
  questions: string[];
  /** How many times ONE ordered it again by itself, after the client's answers or correction. */
  rounds: number;
  /** What the client answered to what was missing, while ONE orders the account again with it. */
  clientAdded: string | null;
  /** ONE asked what was missing in the client's conversation too (0092), not only on the link. */
  askedInChat: boolean;
  /** What a partner or a lawyer decided the case goes on without (0094); empty when nothing was. */
  gapsClosed: AccountTopic[];
};

/** A claim older than this is nobody's any more (the setting `working_minutes` of the sweep, at its default). */
const CLAIM_MINUTES = 15;
/** Work owed for this long with no claim was not picked up by a job. */
const UNCLAIMED_MINUTES = 2;

/** An audio a person of the case sent over WhatsApp, which may become their account. */
export type CaseAudio = { fileId: string; partyId: string; contactName: string; receivedLabel: string };

export type CaseComplaint = {
  id: string;
  channel: ComplaintChannel;
  protocol: string | null;
  filedOn: string | null;
  answerDueOn: string | null;
  answeredOn: string | null;
  outcome: ComplaintOutcome;
  notes: string | null;
};

export type StatementFacts = {
  /** Where the case's account stands, as ONE waits for it before the lawsuits (0090); null when unreadable. */
  account: AccountState | null;
  /** How many times ONE orders an account again by itself (the setting `statements.max_rounds`). */
  accountMaxRounds: number;
  /** The passenger's interview (0095): null with none, or when it could not be read. */
  interview: InterviewView | null;
  statements: CaseStatement[];
  audios: CaseAudio[];
  complaints: CaseComplaint[];
  complaintAnswerDays: Partial<Record<ComplaintChannel, number>>;
};

type StatementRow = {
  id: string;
  party_id: string | null;
  source: string;
  audio_file_id: string | null;
  status: string;
  transcript: string | null;
  transcript_run_id: string | null;
  work: string | null;
  work_claimed_at: string | null;
  work_error: string | null;
  chronology: string | null;
  chronology_status: string;
  client_note: string | null;
  returned_note: string | null;
  missing_topics: string[] | null;
  questions: string[] | null;
  rounds: number | null;
  client_added: string | null;
  asked_at: string | null;
  created_at: string;
};

type Embedded<T> = T | T[] | null;
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

const olderThan = (moment: string, minutes: number): boolean =>
  Date.now() - new Date(moment).getTime() > minutes * 60_000;

/** How many audios of the conversations the screen offers. */
const AUDIOS_SHOWN = 12;

export async function loadStatementFacts(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  timeZone: string | null | undefined,
): Promise<StatementFacts> {
  const [statements, complaints, setting, parties, account, closed, interview] = await Promise.all([
    supabase
      .from("case_statements")
      .select(
        "id, party_id, source, audio_file_id, status, transcript, transcript_run_id, work, work_claimed_at, work_error, chronology, chronology_status, client_note, returned_note, missing_topics, questions, rounds, client_added, asked_at, created_at",
      )
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .order("created_at"),
    supabase
      .from("admin_complaints")
      .select("id, channel, protocol, filed_on, answer_due_on, answered_on, outcome, notes")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .order("created_at"),
    supabase.from("platform_settings").select("value").eq("key", "complaints").maybeSingle(),
    supabase
      .from("case_parties")
      .select("id, role, people(full_name, phone)")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .order("created_at"),
    supabase.rpc("case_account", { target_case: caseId }),
    // What the firm went on without (0094), read apart: a database before it leaves it unsaid, never the case unread.
    supabase
      .from("case_statements")
      .select("id, gaps_closed_topics, gaps_closed_at")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .not("gaps_closed_at", "is", null),
    // The interview, read apart (0095): a read that fails leaves it unsaid, never the case unread.
    supabase.rpc("case_interview_view", { target_case: caseId }),
  ]);
  if (statements.error || complaints.error || setting.error || parties.error) {
    throw new Error("statement facts could not be read");
  }
  // Where the account stands is read apart: a read that fails leaves it unsaid, never the account unread.
  const accountAnswer = (account.error ? null : account.data) as { state?: unknown; max_rounds?: unknown } | null;
  const closedOf = new Map(
    ((closed.error ? [] : (closed.data ?? [])) as { id: string; gaps_closed_topics: string[] | null }[]).map((row) => [
      row.id,
      (row.gaps_closed_topics ?? []).filter(isAccountTopic),
    ]),
  );

  const rows = (statements.data ?? []) as StatementRow[];
  const told: CaseStatement[] = rows
    // An audio a client reserved and that has not arrived is nothing of the case yet.
    .filter((row) => row.status === "received")
    .map((row) => {
      const status = (CHRONOLOGY_STATUSES as readonly string[]).includes(row.chronology_status)
        ? (row.chronology_status as ChronologyStatus)
        : "none";
      const work = row.work === "transcribe" || row.work === "chronology" ? row.work : null;
      return {
        id: row.id,
        partyId: row.party_id,
        source: row.source === "client" || row.source === "whatsapp" ? row.source : "firm",
        spoken: row.audio_file_id !== null,
        audioFileId: row.audio_file_id,
        uploading: false,
        transcript: row.transcript,
        work,
        transcriptWaits:
          row.transcript === null && work === null && row.transcript_run_id !== null && row.work_error === null,
        workError: row.work_error,
        chronology: chronologyShown(status) ? row.chronology : null,
        chronologyStatus: status,
        // Kept in sight while another chronology is proposed and decided: it is what that one must answer.
        clientNote: row.client_note,
        previousChronology: !chronologyShown(status) && row.client_note ? row.chronology : null,
        firmNote: row.returned_note,
        receivedLabel: momentLabel(row.created_at, timeZone),
        stalled:
          work !== null &&
          (row.work_claimed_at === null
            ? row.work_error !== null || olderThan(row.created_at, UNCLAIMED_MINUTES)
            : olderThan(row.work_claimed_at, CLAIM_MINUTES)),
        missingTopics: (row.missing_topics ?? []).filter(isAccountTopic),
        questions: (row.questions ?? []).filter((question) => typeof question === "string" && question.trim() !== ""),
        rounds: typeof row.rounds === "number" ? row.rounds : 0,
        clientAdded: row.client_added,
        askedInChat: row.asked_at !== null,
        gapsClosed: closedOf.get(row.id) ?? [],
      };
    });

  // The audios the case's people sent to the firm over WhatsApp, by the phone each one has on file.
  type PartyRow = { id: string; role: string; people: Embedded<{ full_name: string; phone: string | null }> };
  const byWaId = new Map<string, { partyId: string; name: string }>();
  for (const party of (parties.data ?? []) as PartyRow[]) {
    const person = one(party.people);
    for (const candidate of waIdCandidates(person?.phone ?? "")) {
      // A parent is a claimant and a guardian: the claimant speaks first.
      if (!byWaId.has(candidate) || party.role === "claimant") {
        byWaId.set(candidate, { partyId: party.id, name: person?.full_name ?? "" });
      }
    }
  }
  const audios: CaseAudio[] = [];
  if (byWaId.size > 0) {
    const { data: conversations, error: conversationsError } = await supabase
      .from("wa_conversations")
      .select("id, contact_wa_id")
      .eq("org_id", firmId)
      .in("contact_wa_id", [...byWaId.keys()]);
    if (conversationsError) throw new Error("conversations could not be read");
    const owner = new Map(
      ((conversations ?? []) as { id: string; contact_wa_id: string }[]).map((row) => [
        row.id,
        byWaId.get(row.contact_wa_id) ?? null,
      ]),
    );
    if (owner.size > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from("wa_messages")
        .select("id, conversation_id, media_file_id, created_at")
        .eq("org_id", firmId)
        .in("conversation_id", [...owner.keys()])
        .eq("direction", "in")
        .eq("kind", "audio")
        .eq("media_status", "stored")
        .not("media_file_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(AUDIOS_SHOWN * 3);
      if (messagesError) throw new Error("messages could not be read");
      const used = new Set(rows.map((row) => row.audio_file_id).filter(Boolean));
      for (const message of (messages ?? []) as {
        conversation_id: string;
        media_file_id: string;
        created_at: string;
      }[]) {
        const who = owner.get(message.conversation_id);
        if (!who || used.has(message.media_file_id) || audios.length >= AUDIOS_SHOWN) continue;
        used.add(message.media_file_id);
        audios.push({
          fileId: message.media_file_id,
          partyId: who.partyId,
          contactName: who.name,
          receivedLabel: momentLabel(message.created_at, timeZone),
        });
      }
    }
  }

  const days = (setting.data?.value as { answer_days?: Record<string, unknown> } | null)?.answer_days ?? {};
  const complaintAnswerDays: Partial<Record<ComplaintChannel, number>> = {};
  for (const [channel, value] of Object.entries(days)) {
    if (isComplaintChannel(channel) && typeof value === "number" && value > 0) complaintAnswerDays[channel] = value;
  }

  return {
    account: accountStateOf(accountAnswer?.state),
    accountMaxRounds: typeof accountAnswer?.max_rounds === "number" ? accountAnswer.max_rounds : 0,
    interview: interview.error ? null : interviewViewOf(interview.data),
    statements: told,
    audios,
    complaints: (
      (complaints.data ?? []) as {
        id: string;
        channel: string;
        protocol: string | null;
        filed_on: string | null;
        answer_due_on: string | null;
        answered_on: string | null;
        outcome: string;
        notes: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      channel: isComplaintChannel(row.channel) ? row.channel : "other",
      protocol: row.protocol,
      filedOn: row.filed_on,
      answerDueOn: row.answer_due_on,
      answeredOn: row.answered_on,
      outcome: isComplaintOutcome(row.outcome) ? row.outcome : "pending",
      notes: row.notes,
    })),
    complaintAnswerDays,
  };
}
