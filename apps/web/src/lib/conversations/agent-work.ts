import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { runFirmTask } from "@/lib/ai/executor";
import {
  accountAnswered,
  accountAnswersText,
  accountBackLine,
  accountQuestionLine,
  accountQuestionOf,
  accountThanksMessage,
} from "@/lib/cases/account";
import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { firstNameOf } from "@/lib/cases/cases";
import { base64, MODEL_IMAGE, processCaseDocuments, queueDocumentProcessing } from "@/lib/cases/documents-work";
import {
  advanceInterview,
  answerInterview,
  answerWithPaper,
  readInterview,
  startInterview,
} from "@/lib/cases/interview-work";
import { alertQualification } from "@/lib/cases/qualification";
import { queueStatementWork } from "@/lib/cases/statements-work";
import {
  byPersonMessage,
  calledMessage,
  caseOpenedNoLinkMessage,
  caseStepsMessage,
  cleanReply,
  CONVERSATION_TASK,
  declinedMessage,
  FILE_KIND_TASK,
  type FileOutcome,
  fileRole,
  filesMessage,
  intakeOpenedMessage,
  lastClientWords,
  minorsOf,
  modelAnswerOf,
  modelInput,
  notQualifiedMessage,
  type PaperKind,
  paperOf,
  quickAnswer,
  type TurnContext,
  turnContextOf,
  type TurnFile,
  turnFilesOf,
} from "@/lib/conversations/agent";
import {
  CEP_NOT_FOUND,
  CEP_QUESTION,
  cepOf,
  choose,
  DATA_OPTIONS,
  dataDone,
  dataSummary,
  FIELD_OPTIONS,
  FIELD_QUESTION,
  MARITAL_OPTIONS,
  missingAsk,
  NATIONALITY_OPTIONS,
  NUMBER_QUESTION,
  numberOf,
  OTHER_NATIONALITY_QUESTION,
  type PersonData,
  personDataOf,
  readValue,
  valueQuestion,
} from "@/lib/conversations/data-check";
import { takeHearingReport } from "@/lib/conversations/hearing-report-work";
import {
  arrivalOptions,
  choiceOf,
  companionsOf,
  CORRECTION_QUESTION,
  INTAKE_TASK,
  intakeDoubts,
  type IntakeFacts,
  intakeFactsOf,
  intakeInput,
  intakeMissing,
  type IntakeNames,
  intakeNextAsk,
  intakeOffer,
  intakePersonalMissing,
  intakeQualificationInput,
  intakeQuestion,
  intakeReadingOf,
  intakeSummary,
  isChild,
  OPTIONS,
  questionText,
} from "@/lib/conversations/intake";
import { nextPaperAsk, NOT_HAVE_LINE, type PapersOwed, papersOwedOf, saysNotHave } from "@/lib/conversations/papers";
import {
  ACCOUNT_RECEIVED,
  ACCOUNT_SHORT,
  FACTS_CONFIRMED,
  FACTS_CORRECTED,
  FACTS_CORRECTION,
  FACTS_LINE,
  FACTS_TOO_SHORT,
  factsChoice,
  freeJusticeExplained,
  legAnswered,
  legAsk,
  legChoice,
  questionAnswered,
  questionChoice,
  RESIDENCE_ANSWERED,
  residenceAsk,
  residenceChoice,
  residenceNoteAsk,
  residenceNoteOf,
} from "@/lib/conversations/questions";
import { supabaseFileStore } from "@/lib/files/store";
import { fillMessage } from "@/lib/firm/messages";
import { firmMessageText } from "@/lib/firm/messages-read";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { normalizeImage } from "@flyee/documents/normalize";
import type { FileStore } from "@flyee/documents/types";
import { viaCep } from "@flyee/fields";
import { qualify } from "@flyee/rules/qualification";
import { checkMessage } from "@flyee/whatsapp/rules";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of ONE in a conversation (migration 0048): a turn is
 * claimed under a number, read, and answered. The passenger's plain answer
 * to ONE's first word is the database's to keep (a yes opens the case with
 * the trip and sends the link with the next steps; a no ends it; a stop
 * stops everything); anything else is read by a run of the task
 * `atendimento.conversa`, whose answer goes as ONE's when the firm lets it,
 * or waits in the queue for a person's "Enviar". When ONE cannot go on, it
 * calls a person. Every message goes through the outbox of 0019, once.
 * A file the passenger sent (0050) joins their case first: a photo or a PDF
 * is read by the task `atendimento.arquivo.tipo` (what paper it is, the name
 * on it), joins as that paper and is checked at once as a paper sent through
 * the link is; an audio joins as their account of what happened; and ONE
 * says what became of each. Nothing of a passenger is kept in a job's state:
 * the steps carry ids and counts.
 */

export type TurnReport = { claimed: number; answered: number; opened: number; called: number; failed: number };

/** How many answers ONE gives a conversation in an hour before it calls a person (the database's setting is read with the turn). */
const ANSWERS_PER_HOUR = 20;

/** Today on the platform's calendar (Brasília): the day a child is a child on. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function send(service: SupabaseClient, messageId: unknown): Promise<void> {
  if (typeof messageId !== "string") return;
  try {
    await deliverOutbox(service, { messageId });
  } catch {
    // Queued: the outbox's sweep sends it.
  }
}

type Held = { conversationId: string; claim: number };

async function rpc(
  service: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name} failed`);
  return (data ?? {}) as Record<string, unknown>;
}

/** Whether the platform opens the interview of a case's start (off since 0239); a read that fails says no. */
async function interviewOpens(service: SupabaseClient): Promise<boolean> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "interview").maybeSingle();
  return (data as { value?: { start?: unknown } } | null)?.value?.start === true;
}

/** Whether the passenger signs the power of attorney before ONE's questions (0181); a read that fails says no. */
async function signsFirst(service: SupabaseClient, orgId: string): Promise<boolean> {
  const answer = await rpc(service, "firm_signs_first", { target_org: orgId }).catch(() => null);
  return answer?.signs_first === true;
}

/** ONE says something of its own in the conversation, and it is sent. */
/** The firm's own words of one of ONE's messages, its values written in (0191); ONE's own words otherwise. */
async function wordsOf(
  service: SupabaseClient,
  orgId: string,
  key: string,
  fallback: string,
  values: Record<string, string> = {},
): Promise<string> {
  const firm = await firmMessageText(service, orgId, key).catch(() => null);
  return firm ? fillMessage(firm, values) : fallback;
}

/** A passenger's first name, as the messages greet them. */
const greeting = (name: string | null | undefined): string => firstNameOf(name ?? "") || (name ?? "");

async function say(service: SupabaseClient, held: Held, body: string): Promise<void> {
  const answer = await rpc(service, "one_say", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_body: body,
  });
  if (answer.ok) await send(service, answer.message_id);
}

async function callPerson(service: SupabaseClient, held: Held, reason: string): Promise<void> {
  await rpc(service, "call_person", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_reason: reason,
  });
}

/** The largest PDF the task that says what paper a file is reads; a larger one joins as a paper of no kind. */
const PAPER_MAX_BYTES = 20 * 1024 * 1024;

/** What paper a file is, as the task reads it; a paper of no kind when it cannot say (or waits for a person). */
async function paperOfFile(
  store: FileStore,
  context: TurnContext,
  file: TurnFile,
): Promise<{ kind: PaperKind; name: string }> {
  const unknown = { kind: "other" as const, name: "" };
  if (!file.storagePath || !file.mime) return unknown;
  const bytes = await store.get(file.storagePath);
  if (!bytes) return unknown;
  let attachment: { kind: "image" | "document"; mime: string; dataBase64: string };
  if (file.mime === "application/pdf") {
    if (bytes.byteLength > PAPER_MAX_BYTES) return unknown;
    attachment = { kind: "document", mime: "application/pdf", dataBase64: base64(bytes) };
  } else {
    try {
      attachment = {
        kind: "image",
        mime: "image/jpeg",
        dataBase64: base64((await normalizeImage(bytes, MODEL_IMAGE)).jpeg),
      };
    } catch {
      // An image the backend cannot read (a HEIC its build of sharp has no decoder for): a person sees it.
      return unknown;
    }
  }
  const run = await runFirmTask({
    orgId: context.orgId,
    task: FILE_KIND_TASK,
    // What is hashed for the record: the file's own hash, never its bytes.
    input: { sha256: file.sha256 ?? file.fileId },
    messages: [{ role: "user", content: "Que papel é este arquivo?", attachments: [attachment] }],
    subject: { type: "wa_message", id: file.messageId },
    idempotencyKey: `file-kind:${file.messageId}`,
  });
  return run.kind === "finished" && !run.approvalId ? paperOf(run.output) : unknown;
}

/**
 * The files the passenger sent since ONE last answered: each joins their
 * case being gathered (or is set aside for a person), a paper is checked at
 * once, and ONE says what became of each in one message. The statements
 * joined are worked on once that message went. Answers whether there was any.
 */
async function joinFiles(service: SupabaseClient, held: Held, context: TurnContext): Promise<boolean> {
  const listed = await rpc(service, "conversation_media_to_join", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  });
  const files = turnFilesOf(listed.items);
  if (files.length === 0) return false;
  const store = supabaseFileStore(service);
  const join = (file: TurnFile, kind: string, name: string | null = null) =>
    rpc(service, "one_join_conversation_media", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_message: file.messageId,
      target_kind: kind,
      target_name: name,
    });

  const outcomes: FileOutcome[] = [];
  const statements: string[] = [];
  let residence: { partyId: string; holder: string } | null = null;
  for (const file of files) {
    const role = fileRole(file);
    if (role === "failed" || role === "not_taken") {
      await join(file, "left");
      outcomes.push({ kind: role });
      continue;
    }
    if (role === "statement") {
      const joined = await join(file, "statement");
      if (joined.code === "statement" && typeof joined.statement_id === "string") {
        statements.push(joined.statement_id);
        outcomes.push({ kind: "statement" });
      } else if (joined.code === "no_case") outcomes.push({ kind: "no_case" });
      continue;
    }
    const paper = await paperOfFile(store, context, file);
    const joined = await join(file, paper.kind, paper.name || null);
    if (joined.code === "no_case") {
      outcomes.push({ kind: "no_case" });
      continue;
    }
    if (joined.code !== "document" || typeof joined.document_id !== "string") continue;
    // The same check as a paper sent through the link, now: the passenger hears what came of it here.
    await processCaseDocuments(service, 1, joined.document_id).catch(() => undefined);
    const { data: decided } = await service
      .from("case_documents")
      .select("status, rejected_reason")
      .eq("id", joined.document_id)
      .maybeSingle();
    const status =
      decided?.status === "accepted" ? "accepted" : decided?.status === "rejected" ? "rejected" : "waiting";
    const owing =
      status === "accepted" && paper.kind === "address_proof"
        ? await residenceOwedBy(service, joined.document_id).catch(() => null)
        : null;
    if (owing) residence = owing;
    outcomes.push({
      kind: "paper",
      paper: paper.kind,
      status,
      reason: typeof decided?.rejected_reason === "string" ? decided.rejected_reason : null,
      named: status === "accepted" ? await nameTakenFrom(service, joined.document_id).catch(() => null) : null,
      holder: owing?.holder ?? null,
    });
  }

  const said = filesMessage(outcomes);
  // A bill in somebody else's name the firm took: who the holder is to the client is asked at once, in the same
  // message, as the conversation's step (0237); the next document waits for the answer.
  if (residence) {
    const asked = await rpc(service, "one_ask_chat_question", {
      target_conversation: held.conversationId,
      target_kind: "residence",
      target_party: residence.partyId,
      target_body: [said, residenceAsk(residence.holder)].filter(Boolean).join("\n"),
    }).catch((): Record<string, unknown> => ({}));
    if (asked.ok === true) {
      if (typeof asked.message_id === "string") await send(service, asked.message_id);
      for (const statementId of statements) await workStatement(statementId);
      return true;
    }
  }
  // What came of the files, and the next document owed, in one message (0230); after a paper refused, its reason
  // already says what to send, and the next one waits for it (0236).
  const papers = outcomes.filter((outcome) => outcome.kind === "paper");
  const next =
    papers.length > 0 && !papers.some((outcome) => outcome.status === "rejected")
      ? await nextPaper(service, held, context).catch(() => null)
      : null;
  const message = [said, next].filter(Boolean).join("\n");
  if (message) await say(service, held, message);
  for (const statementId of statements) await workStatement(statementId);
  return true;
}

/** The person's name an accepted identity wrote in place of the one typed (0236); null when it wrote none. */
async function nameTakenFrom(service: SupabaseClient, documentId: string): Promise<string | null> {
  const { data: event } = await service
    .from("case_events")
    .select("data")
    .eq("kind", "person_named_by_document")
    .contains("data", { document: documentId })
    .limit(1)
    .maybeSingle();
  const person = (event as { data?: { person?: unknown } } | null)?.data?.person;
  if (typeof person !== "string") return null;
  const { data } = await service.from("people").select("full_name").eq("id", person).maybeSingle();
  const name = (data as { full_name?: unknown } | null)?.full_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * The declaration of residence an accepted bill in somebody else's name opened (0123), still waiting for who the holder
 * is to the client (0237): its holder and the party it is asked of; null when it opened none.
 */
async function residenceOwedBy(
  service: SupabaseClient,
  documentId: string,
): Promise<{ partyId: string; holder: string } | null> {
  const { data: declaration } = await service
    .from("residence_declarations")
    .select("holder_name")
    .eq("document_id", documentId)
    .eq("status", "open")
    .is("relation", null)
    .maybeSingle();
  const holder = (declaration as { holder_name?: unknown } | null)?.holder_name;
  if (typeof holder !== "string" || !holder.trim()) return null;
  const { data: document } = await service.from("case_documents").select("party_id").eq("id", documentId).maybeSingle();
  const partyId = (document as { party_id?: unknown } | null)?.party_id;
  return typeof partyId === "string" ? { partyId, holder: holder.trim() } : null;
}

/** How many months back a proof of address may be dated (0237): the platform's setting, three when unread. */
async function addressMonths(service: SupabaseClient): Promise<number> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "address_proof").maybeSingle();
  const months = Number((data as { value?: { max_age_months?: unknown } } | null)?.value?.max_age_months);
  return Number.isInteger(months) && months >= 1 && months <= 24 ? months : 3;
}

/** The documents the case this conversation gathers still owes, as the database says it; null with no case. */
async function papersOwed(service: SupabaseClient, held: Held): Promise<PapersOwed | null> {
  return papersOwedOf(
    await rpc(service, "conversation_papers_owed", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
    }),
  );
}

/** Whether ONE already asked the dispensable documents in this conversation. */
const dispensablesAsked = (context: TurnContext): boolean =>
  context.messages.some((message) => message.author === "one" && message.text.endsWith(NOT_HAVE_LINE));

/** What ONE asks next of the documents (0230): the next one owed, the dispensable ones, or that the signature comes. */
async function nextPaper(service: SupabaseClient, held: Held, context: TurnContext): Promise<string | null> {
  const papers = await papersOwed(service, held);
  if (!papers) return null;
  // Nothing essential owed: the client checks what ONE read, before anything else (0232).
  if (!papers.owed.some((owed) => !owed.rejected)) {
    const check = await startDataCheck(service, held).catch(() => null);
    if (check) return check;
  }
  return nextPaperAsk(papers, {
    dispensablesAsked: dispensablesAsked(context),
    addressMonths: await addressMonths(service).catch(() => 3),
  });
}

/** The passenger's data of the case this conversation gathers (0232); null with no case. */
async function personData(service: SupabaseClient, held: Held): Promise<PersonData | null> {
  const answer = await rpc(service, "conversation_person", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  });
  return answer.code === "person" ? personDataOf(answer) : null;
}

/** Where the conversation stands after the case opened (0232); `checked` adds a case whose data was checked. */
async function keepStep(
  service: SupabaseClient,
  held: Held,
  step: Record<string, string>,
  checked: string | null = null,
): Promise<boolean> {
  const kept = await rpc(service, "record_chat_step", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_step: step,
    target_checked: checked,
  });
  return kept.ok === true;
}

/** The client's own data written in the chat, through the link's checks; `confirm` makes what ONE read theirs. */
async function writePerson(
  service: SupabaseClient,
  held: Held,
  fields: Record<string, string>,
  confirm = false,
): Promise<boolean> {
  const written = await rpc(service, "one_person_fields", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_fields: fields,
    target_confirm: confirm,
  });
  return written.ok === true;
}

/**
 * The check of data starts (0232) once nothing essential is owed, the identity and the proof of address were accepted,
 * and it was not done for this case: the summary of what ONE read, and the step it waits on. Null when not now.
 */
async function startDataCheck(service: SupabaseClient, held: Held): Promise<string | null> {
  const data = await personData(service, held);
  if (!data || data.minor || !data.documentsIn || data.checked || data.step) return null;
  if (!(await keepStep(service, held, { step: "dados" }))) return null;
  return dataSummary(data);
}

/** The next question of the data still missing, or the end of the check with what comes after it. */
async function nextDataStep(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  data: PersonData,
): Promise<string> {
  const missing = missingAsk(data);
  if (missing) {
    await keepStep(service, held, { step: missing.step });
    return missing.question;
  }
  await keepStep(service, held, {}, data.caseId);
  // The client gave the last of their data: ONE prepares the papers to sign right after, never at the sweep's next
  // round (0237); the database already woke the case.
  await queueCaseAdvance(data.caseId);
  const after = await nextPaper(service, held, context).catch(() => null);
  return [dataDone(data.fullName), after].filter(Boolean).join("\n");
}

/**
 * The client's answer while the check of data waits for one (0232): the confirmation, the field to correct and its
 * value (an address by its CEP and number), and what the papers need and no document gives. Answers whether it took
 * the turn.
 */
async function takeDataCheck(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  reply: string,
): Promise<boolean> {
  if (!reply.trim()) return false;
  const data = await personData(service, held);
  if (!data?.step) return false;
  const tell = async (body: string) => {
    await say(service, held, body);
    return true;
  };
  const again = async () => {
    const fresh = await personData(service, held);
    if (!fresh) return false;
    await keepStep(service, held, { step: "dados" });
    return tell(dataSummary(fresh));
  };
  const proceed = async (fields: Record<string, string>) => {
    if (!(await writePerson(service, held, fields))) {
      return tell("Não consegui guardar esse dado. Uma pessoa do escritório confere com você.");
    }
    const fresh = await personData(service, held);
    return fresh ? tell(await nextDataStep(service, held, context, fresh)) : false;
  };

  switch (data.step) {
    case "dados": {
      if (choose(DATA_OPTIONS, reply) === "certo") {
        await writePerson(service, held, {}, true);
        const fresh = (await personData(service, held)) ?? data;
        return tell(await nextDataStep(service, held, context, fresh));
      }
      await keepStep(service, held, { step: "campo" });
      return tell(FIELD_QUESTION);
    }
    case "campo": {
      const field = choose(FIELD_OPTIONS, reply);
      if (field === "address") {
        await keepStep(service, held, { step: "cep" });
        return tell(CEP_QUESTION);
      }
      if (field === "full_name" || field === "cpf" || field === "birth_date") {
        await keepStep(service, held, { step: "valor", field });
        return tell(valueQuestion(field));
      }
      return tell(FIELD_QUESTION);
    }
    case "valor": {
      if (!data.field) return again();
      const value = readValue(data.field, reply);
      if (!value.ok) return tell(value.why);
      if (!(await writePerson(service, held, { [data.field]: value.value }))) {
        return tell("Esse dado não confere com o que o escritório já tem. Uma pessoa do escritório confere com você.");
      }
      return again();
    }
    case "cep": {
      const cep = cepOf(reply);
      const found = cep ? await viaCep.lookup(cep).catch(() => null) : null;
      if (!cep || !found) return tell(CEP_NOT_FOUND);
      const written = await writePerson(service, held, {
        postal_code: found.postalCode,
        street: found.street,
        district: found.district,
        city: found.city,
        uf: found.state,
      });
      if (!written) return tell(CEP_NOT_FOUND);
      await keepStep(service, held, { step: "numero" });
      return tell(NUMBER_QUESTION);
    }
    case "numero": {
      const read = numberOf(reply);
      if (!read) return tell(NUMBER_QUESTION);
      await writePerson(service, held, {
        address_number: read.number,
        ...(read.complement ? { complement: read.complement } : {}),
      });
      return again();
    }
    case "nacionalidade": {
      const chosen = choose(NATIONALITY_OPTIONS, reply);
      if (chosen === "brasileira") return proceed({ nationality: "brasileira" });
      if (chosen === "outra") {
        await keepStep(service, held, { step: "nacionalidade_outra" });
        return tell(OTHER_NATIONALITY_QUESTION);
      }
      return tell(missingAsk({ ...data, nationality: null })?.question ?? OTHER_NATIONALITY_QUESTION);
    }
    case "nacionalidade_outra": {
      const said = reply.trim().replace(/\s+/g, " ").slice(0, 60);
      return said.length >= 3 ? proceed({ nationality: said.toLowerCase() }) : tell(OTHER_NATIONALITY_QUESTION);
    }
    case "estado_civil": {
      const chosen = choose(MARITAL_OPTIONS, reply);
      return chosen
        ? proceed({ marital_status: chosen })
        : tell(missingAsk({ ...data, maritalStatus: null })!.question);
    }
    case "profissao": {
      const said = reply.trim().replace(/\s+/g, " ").slice(0, 120);
      return said.length >= 2 ? proceed({ profession: said }) : tell("Qual é a sua profissão?");
    }
  }
}

/**
 * On which leg the problem was, as the client says it in the chat (0240): a leg of the list, or "Não lembro" (ANAC's
 * record decides then). A question of theirs is ONE's usual answer, the step still waiting. Answers whether it took
 * the turn.
 */
async function takeLegAnswer(
  service: SupabaseClient,
  held: Held,
  reply: string,
  chatStep: Record<string, unknown>,
): Promise<boolean> {
  const caseId = typeof chatStep.case === "string" ? chatStep.case : null;
  if (!caseId || !reply.trim()) return false;
  const { data: legs } = await service
    .from("flight_segments")
    .select("flight_number, origin_iata, destination_iata, position")
    .eq("case_id", caseId)
    .order("position");
  const listed = (
    (legs ?? []) as { flight_number: string | null; origin_iata: string | null; destination_iata: string | null }[]
  )
    .map((leg) =>
      [
        leg.flight_number,
        leg.origin_iata && leg.destination_iata ? `de ${leg.origin_iata} para ${leg.destination_iata}` : null,
      ]
        .filter(Boolean)
        .join(", "),
    )
    .join("\n");
  const choice = legChoice(listed, reply);
  if (choice === null) {
    if (reply.includes("?")) return false;
    await say(service, held, `Responda com o número da opção.\n${legAsk(listed)}`);
    return true;
  }
  const kept = await rpc(service, "one_answer_problem_leg", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_choice: choice,
  });
  if (kept.ok !== true) return false;
  await say(service, held, legAnswered(typeof kept.flight === "string" ? kept.flight : null));
  return true;
}

/**
 * The client's own account of what happened, written in the chat after ONE asked for it (0239): it becomes their
 * account and ONE puts it in order, then asks what it lacks one question at a time (0235). A short question of theirs
 * is ONE's usual answer, the account still asked; a reply too short to be one asks for more. An audio joined as the
 * account already (0050). Answers whether it took the turn.
 */
async function takeAccountStory(service: SupabaseClient, held: Held, context: TurnContext): Promise<boolean> {
  const told = lastClientWords(context.messages).join("\n").trim();
  if (!told) return false;
  if (told.length < 80 && told.includes("?")) return false;
  const written = await rpc(service, "one_write_account", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_text: told,
    target_message: null,
  });
  if (written.ok === true && typeof written.statement_id === "string") {
    await say(service, held, ACCOUNT_RECEIVED);
    await workStatement(written.statement_id);
    return true;
  }
  if (written.code === "statement_length") {
    await say(service, held, ACCOUNT_SHORT);
    return true;
  }
  return false;
}

/**
 * The client's answer to who the holder of their bill is (0237), kept as on their link: an option, or after "Outra
 * pessoa" their own words; then the next document owed. A question of theirs is left to ONE's usual answer, the step
 * still waiting. Answers whether it took the turn.
 */
async function takeResidenceAnswer(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  reply: string,
  chatStep: Record<string, unknown>,
  report: TurnReport,
): Promise<boolean> {
  const caseId = typeof chatStep.case === "string" ? chatStep.case : null;
  const partyId = typeof chatStep.party === "string" ? chatStep.party : null;
  if (!caseId || !partyId) return false;
  const { data: declaration } = await service
    .from("residence_declarations")
    .select("holder_name")
    .eq("case_id", caseId)
    .eq("status", "open")
    .maybeSingle();
  const holder = String((declaration as { holder_name?: unknown } | null)?.holder_name ?? "");
  const answer = async (relation: string, note: string | null) => {
    const kept = await rpc(service, "one_answer_residence", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_relation: relation,
      target_note: note,
      target_message: null,
    });
    if (kept.ok !== true) {
      await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
        () => undefined,
      );
      await callPerson(
        service,
        held,
        "O cliente disse no chat quem é o titular da conta de endereço, mas a resposta não pôde ser guardada: uma pessoa do escritório confere.",
      );
      report.called += 1;
      return true;
    }
    const next = await nextPaper(service, held, context).catch(() => null);
    await say(service, held, [RESIDENCE_ANSWERED, next].filter(Boolean).join("\n"));
    return true;
  };
  if (chatStep.ask === "note") {
    const note = residenceNoteOf(reply);
    if (note) return answer("outro", note);
    if (reply.includes("?")) return false;
    await say(service, held, residenceNoteAsk(holder));
    return true;
  }
  const choice = residenceChoice(reply);
  if (choice === "outro") {
    await keepStep(service, held, { step: "residence", party: partyId, case: caseId, ask: "note" });
    await say(service, held, residenceNoteAsk(holder));
    return true;
  }
  if (choice) return answer(choice, null);
  if (reply.includes("?")) return false;
  await say(service, held, `Responda com o número da opção.\n${residenceAsk(holder)}`);
  return true;
}

/**
 * The client's answer to a word ONE asked in the chat (0233): free justice or the civil court, kept as on the link.
 * Answers whether it took the turn.
 */
async function takeChatQuestion(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  reply: string,
  report: TurnReport,
): Promise<boolean> {
  if (!reply.trim()) return false;
  const { data: row } = await service
    .from("wa_conversations")
    .select("chat_step")
    .eq("id", held.conversationId)
    .maybeSingle();
  const chatStep = (row as { chat_step?: Record<string, unknown> } | null)?.chat_step ?? {};
  const step = chatStep.step;
  if (step === "residence") return takeResidenceAnswer(service, held, context, reply, chatStep, report);
  if (step === "account") return takeAccountStory(service, held, context);
  if (step === "leg") return takeLegAnswer(service, held, reply, chatStep);
  if (step !== "free_justice" && step !== "civil_court") return false;
  const choice = questionChoice(step, reply);
  if (step === "free_justice" && choice === "explicar") {
    await say(service, held, freeJusticeExplained());
    return true;
  }
  if (step === "civil_court" && choice === "duvidas") {
    await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
      () => undefined,
    );
    await callPerson(
      service,
      held,
      "O cliente tem dúvidas antes de aceitar a ação na vara cível: uma pessoa do escritório responde.",
    );
    report.called += 1;
    return true;
  }
  if (choice !== "sim" && choice !== "nao") {
    await say(
      service,
      held,
      step === "free_justice"
        ? freeJusticeExplained()
        : "Responda 1 para aceitar ou 2 para não aceitar. Se tiver dúvidas, responda 3.",
    );
    return true;
  }
  const kept = await rpc(service, "one_answer_chat_question", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_value: choice === "sim",
    target_message: null,
  });
  if (kept.ok === true) {
    await say(service, held, questionAnswered(step, choice === "sim"));
  } else {
    await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
      () => undefined,
    );
    await callPerson(
      service,
      held,
      "O cliente respondeu no chat, mas a resposta não pôde ser guardada: uma pessoa do escritório confere.",
    );
    report.called += 1;
  }
  return true;
}

/**
 * The client's word on the facts of their action, in the chat (0182, 0233): confirmed, or what is wrong, kept as on
 * the link. Answers whether it took the turn.
 */
async function takeFactsAnswer(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  reply: string,
): Promise<boolean> {
  if (!reply.trim()) return false;
  const lastOne = [...context.messages].reverse().find((message) => message.author === "one")?.text ?? "";
  const answer = (confirmed: boolean, note: string | null) =>
    rpc(service, "one_answer_piece_facts", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_confirmed: confirmed,
      target_note: note,
    });
  if (lastOne.endsWith(FACTS_LINE)) {
    const choice = factsChoice(reply);
    if (choice === "certo") {
      const kept = await answer(true, null);
      if (kept.ok !== true) return false;
      await say(service, held, FACTS_CONFIRMED);
      return true;
    }
    if (choice === "errado") {
      await say(service, held, FACTS_CORRECTION);
      return true;
    }
    return false;
  }
  if (lastOne === FACTS_CORRECTION || lastOne === FACTS_TOO_SHORT) {
    const note = reply.trim().replace(/\s+/g, " ");
    if (note.length < 10) {
      await say(service, held, FACTS_TOO_SHORT);
      return true;
    }
    const kept = await answer(false, note.slice(0, 2000));
    if (kept.ok !== true) return false;
    await say(service, held, FACTS_CORRECTED);
    return true;
  }
  return false;
}

/**
 * The client's answer to a question of their account, in the chat (0092, one at a time since 0235): the next question
 * after each answer, and after the last the answers join the account, as an answer on the link does, and ONE orders it
 * again. A question that waits after another step came between is asked again. Answers whether it took the turn.
 */
async function takeAccountAnswer(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  statementId: string,
  firstName: string,
): Promise<boolean> {
  const { data } = await service.from("case_statements").select("questions").eq("id", statementId).maybeSingle();
  const listed = (data as { questions?: unknown } | null)?.questions;
  const questions = (Array.isArray(listed) ? listed : []).filter(
    (question): question is string => typeof question === "string" && question.trim() !== "",
  );
  const replied = lastClientWords(context.messages);
  const complete = async (text: string) => {
    const completed = await rpc(service, "one_complete_statement", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_statement: statementId,
      target_text: text,
    });
    if (!completed.ok) return false;
    await say(service, held, accountThanksMessage(firstName)).catch(() => undefined);
    await workStatement(statementId);
    return true;
  };
  const lastOne = [...context.messages].reverse().find((message) => message.author === "one")?.text ?? "";
  const asked = accountQuestionOf(lastOne);
  if (!asked) {
    // Every question in one message, as before 0235: the reply answers them all.
    if (lastOne.includes("numa mensagem só") || questions.length === 0) return complete(replied.join("\n"));
    // Another step came between: the first question not answered is asked again.
    const answered = accountAnswered(context.messages);
    const next = questions.findIndex((_question, index) => !answered.has(index + 1));
    if (next < 0) return complete(accountAnswersText(context.messages, questions));
    await say(service, held, `${accountBackLine}\n${accountQuestionLine(next + 1, questions.length, questions[next])}`);
    return true;
  }
  if (asked.index < questions.length) {
    await say(service, held, accountQuestionLine(asked.index + 1, questions.length, questions[asked.index]));
    return true;
  }
  return complete(accountAnswersText(context.messages, questions));
}

/**
 * The client's "Não tenho" to the dispensable documents ONE asked (0230): kept as their word, as on their link, and
 * said back. Answers whether it took the turn.
 */
async function takeNotHave(service: SupabaseClient, held: Held, context: TurnContext, reply: string): Promise<boolean> {
  const lastOne = [...context.messages].reverse().find((message) => message.author === "one");
  if (!lastOne || !lastOne.text.endsWith(NOT_HAVE_LINE) || !saysNotHave(reply)) return false;
  const kept = await rpc(service, "one_dispensables_not_had", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  });
  if (kept.ok !== true) return false;
  await say(service, held, "Tudo bem, anotei que você não tem. O escritório segue com o que já tem.");
  return true;
}

/**
 * A statement joined from the conversation is transcribed and put in order right after, on its own, so the turn
 * never waits for a model hearing an audio.
 */
async function workStatement(statementId: string): Promise<void> {
  await queueStatementWork(statementId);
}

/**
 * The partner agency a trip of an alert came from (0070), by its name: the case it opens comes with the agency's
 * record (0071), and the next steps say so. Null for a trip of the firm's own, or when it could not be read (the
 * steps of a passenger of the firm's own then go, which still lead to the link).
 */
async function agencyOfAlert(service: SupabaseClient, alertId: string): Promise<string | null> {
  const { data, error } = await service
    .from("flight_alerts")
    .select("tracked_trips(pax_trips(partner_links(partners(name))))")
    .eq("id", alertId)
    .maybeSingle();
  if (error || !data) return null;
  const one = (value: unknown): Record<string, unknown> | null => {
    const row = Array.isArray(value) ? value[0] : value;
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  };
  const name = one(
    one(one(one((data as Record<string, unknown>).tracked_trips)?.pax_trips)?.partner_links)?.partners,
  )?.name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/**
 * The rule of qualification on ONE's word about a flight (0147), from the alert and its trip's legs; null when they
 * could not be read, and the case then opens as before (the rule runs on the case too).
 */
async function qualifyAlert(service: SupabaseClient, alertId: string) {
  const { data, error } = await service
    .from("flight_alerts")
    .select(
      "kind, delay_minutes, tracked_trips(tracked_legs(scheduled_departure_local, origin_iata, destination_iata))",
    )
    .eq("id", alertId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const trip = (Array.isArray(row.tracked_trips) ? row.tracked_trips[0] : row.tracked_trips) as {
    tracked_legs?: { scheduled_departure_local: string; origin_iata: string; destination_iata: string }[];
  } | null;
  const legs = trip?.tracked_legs ?? [];
  const codes = [...new Set(legs.flatMap((leg) => [leg.origin_iata, leg.destination_iata]))];
  let international: boolean | null = null;
  if (codes.length > 0) {
    const airports = await service.from("airports").select("iata, country").in("iata", codes);
    if (!airports.error) {
      const known = (airports.data ?? []) as { iata: string; country: string }[];
      international = known.some((airport) => airport.country !== "BR")
        ? true
        : known.length === codes.length
          ? false
          : null;
    }
  }
  const days = legs.map((leg) => String(leg.scheduled_departure_local).slice(0, 10)).sort();
  return alertQualification({
    kind: String(row.kind),
    delayMinutes: typeof row.delay_minutes === "number" ? row.delay_minutes : null,
    flightDay: days[0] ?? null,
    international,
    today: today(),
  });
}

/** A yes: the case opened with the trip, and the link with the next steps; or the yes kept for a person. */
async function openCase(service: SupabaseClient, held: Held, context: TurnContext, report: TurnReport): Promise<void> {
  const alert = context.alert;
  if (!alert) return;
  // A problem the rule does not qualify opens no case: the firm's word, and the passenger kept with the reason.
  const verdict = await qualifyAlert(service, alert.alertId);
  if (verdict?.outcome === "not_qualified") {
    const answer = await rpc(service, "one_alert_not_qualified", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_alert: alert.alertId,
      target_result: verdict,
      target_body: await wordsOf(service, context.orgId, "not_qualified", notQualifiedMessage(alert.passengerName), {
        nome: greeting(alert.passengerName),
      }),
    });
    if (answer.code === "not_qualified") {
      await send(service, answer.message_id);
      return;
    }
    if (answer.code === "not_qualified_by_person") {
      await callPerson(
        service,
        held,
        "O passageiro quer seguir, mas pela regra o problema não se qualifica: uma pessoa do escritório responde.",
      );
      report.called += 1;
      return;
    }
    if (answer.code === "answered_before" || answer.code === "already_opened") return;
    throw new Error(`the answer could not be kept: ${String(answer.code)}`);
  }
  const agency = await agencyOfAlert(service, alert.alertId);
  const signFirst = await signsFirst(service, context.orgId);
  const interview = await interviewOpens(service);
  const token = randomBytes(32).toString("base64url");
  const answer = await rpc(service, "one_open_case_from_alert", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_alert: alert.alertId,
    target_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    target_body: await wordsOf(
      service,
      context.orgId,
      "link_steps",
      caseStepsMessage({
        passengerName: alert.passengerName,
        url: `${BRAND.siteUrl}/c/${token}`,
        minors: minorsOf(context, today()),
        agency,
        signFirst,
        interview,
      }),
      { nome: greeting(alert.passengerName), link: `${BRAND.siteUrl}/c/${token}` },
    ),
  });
  // The documents an agency handed over to the case (0071) are checked right after, as a client's are; the sweep
  // takes what that did not finish.
  const handed = Array.isArray(answer.documents) ? answer.documents : [];
  for (const documentId of handed) {
    if (typeof documentId === "string") await queueDocumentProcessing(documentId);
  }
  if (answer.code === "opened" || answer.code === "opened_without_link") {
    report.opened += 1;
    if (answer.code === "opened") await send(service, answer.message_id);
    else await say(service, held, caseOpenedNoLinkMessage(alert.passengerName));
    // The interview starts right after the next steps, here, one question at a time (0095).
    if (typeof answer.case_id === "string") {
      const interviewId = await startInterview(service, answer.case_id).catch(() => null);
      if (interviewId) await advanceInterview(service, interviewId).catch(() => undefined);
    }
    return;
  }
  if (answer.code === "by_person" || answer.code === "agency_closed") {
    await say(service, held, byPersonMessage(alert.passengerName));
    await callPerson(
      service,
      held,
      answer.code === "agency_closed"
        ? "O passageiro quer seguir, mas o acordo dele com a agência não está mais em vigor: uma pessoa do escritório abre o caso sem os dados da agência."
        : "O passageiro quer seguir, e abrir o caso pela conversa espera uma pessoa do escritório.",
    );
    report.called += 1;
    return;
  }
  if (answer.code === "already_opened") return;
  throw new Error(`the case could not be opened: ${String(answer.code)}`);
}

/** The airline and the two cities an intake names, as the platform's tables have them; null where unknown. */
async function intakeNames(service: SupabaseClient, facts: IntakeFacts): Promise<IntakeNames> {
  const said = (facts.companhia ?? "").trim();
  const prefix = (facts.voo ?? "").replace(/\s/g, "").toUpperCase().slice(0, 2);
  let airline: string | null = null;
  const { data: airlines } = await service.from("airlines").select("iata, name").eq("active", true);
  const rows = ((airlines ?? []) as { iata: string; name: string }[]).filter((row) => row.name);
  const low = said.toLowerCase();
  const found =
    rows.find((row) => row.iata === said.toUpperCase()) ??
    rows.find((row) => low !== "" && row.name.toLowerCase() === low) ??
    rows.find((row) => low.length >= 3 && row.name.toLowerCase().startsWith(low)) ??
    rows.find((row) => prefix.length === 2 && row.iata === prefix);
  if (found) airline = found.name;
  else if (/^[\p{L} ]{3,40}$/u.test(said)) airline = said;
  const codes = [facts.origem, facts.destino].filter((code): code is string => !!code && /^[A-Za-z]{3}$/.test(code));
  const cities = new Map<string, string>();
  if (codes.length > 0) {
    const { data } = await service
      .from("airports")
      .select("iata, city, name")
      .in(
        "iata",
        codes.map((code) => code.toUpperCase()),
      );
    for (const row of (data ?? []) as { iata: string; city: string | null; name: string }[]) {
      cities.set(row.iata, row.city || row.name);
    }
  }
  const city = (code: string | undefined) => (code ? (cities.get(code.toUpperCase()) ?? code.toUpperCase()) : null);
  return { airline, origin: city(facts.origem), destination: city(facts.destino) };
}

type Keep = (facts: Record<string, string>, clear?: string[]) => Promise<IntakeFacts | null>;
type Tell = (body: string) => Promise<boolean>;

/**
 * Who wrote with no alert of ONE's and no case (0176), as the chat's script has it (0227): what they told is read and
 * the next thing missing asked, one question at a time, its options numbered; once nothing is, ONE sums it up for them
 * to confirm; confirmed, the rule decides: the firm's word that it does not qualify, a person when the rule cannot say,
 * or the offer with the firm's words on its fees. The case opens only at their "Quero seguir". Answers whether the
 * intake took the turn; one that is not about a flight leaves it to ONE's usual answer. A read that fails never stops
 * the turn.
 */
async function takeIntake(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  report: TurnReport,
): Promise<boolean> {
  const { data: row, error: readError } = await service
    .from("wa_conversations")
    .select("intake, intake_case_id")
    .eq("id", held.conversationId)
    .maybeSingle();
  if (readError || !row || row.intake_case_id) return false;
  const known = intakeFactsOf(row.intake);
  if (known.result?.outcome === "not_qualified") return false;
  const reply = lastClientWords(context.messages).join(" ");
  const started = Object.keys(known).some((key) => key !== "result");
  const keep: Keep = async (facts, clear = []) => {
    const kept = await rpc(service, "record_conversation_intake", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_facts: facts,
      target_clear: clear,
    });
    return kept.ok === true ? intakeFactsOf(kept.facts) : null;
  };
  const tell: Tell = async (body) => {
    await say(service, held, body);
    report.answered += 1;
    return true;
  };

  // After the questions, what the reply chose decides first.
  if (known.etapa === "oferta" || known.etapa === "duvidas" || known.etapa === "recusou") {
    return takeOffer(service, held, context, report, known, reply, keep, tell);
  }
  if (known.etapa === "resumo") {
    const choice = choiceOf(OPTIONS.resumo, reply);
    if (choice === "certo") return decideIntake(service, held, context, report, known, keep, tell);
    if (choice === "corrigir") {
      if (!(await keep({ etapa: "corrigir" }))) return false;
      return tell(CORRECTION_QUESTION);
    }
  }

  // A choice among the options of the question that waits is the answer itself; anything else, the task reads.
  const asked = intakeNextAsk(known);
  const arrivalAsked = asked === "chegada" || asked === "chegada_real";
  const options =
    asked === "problema" || asked === "aviso" || asked === "acompanhantes"
      ? OPTIONS[asked]
      : arrivalAsked
        ? arrivalOptions(known.problema)
        : null;
  const choice = options && asked ? choiceOf(options, reply) : null;
  let facts: IntakeFacts | null;
  if (choice && asked) {
    // The arrival's band (0242), or "Não cheguei a viajar": the notice alone decides a cancellation or a change then.
    facts = await keep(
      arrivalAsked ? (choice === "nao" ? { viajou: "nao" } : { atraso_faixa: choice }) : { [asked]: choice },
    );
  } else {
    const run = await runFirmTask({
      orgId: context.orgId,
      task: INTAKE_TASK,
      input: intakeInput(context, known, today()),
      subject: { type: "wa_conversation", id: held.conversationId },
      idempotencyKey: `intake:${held.conversationId}:${held.claim}`,
    }).catch(() => null);
    if (!run || run.kind !== "finished") return false;
    const reading = intakeReadingOf(run.output);
    if (!reading || (!reading.flight && !started)) return false;
    facts = await keep(reading.facts);
  }
  if (!facts) return false;

  // After the "Quero seguir": how to call them and who travelled along, then the case opens (0239).
  if (facts.etapa === "seguir") {
    const next = intakePersonalMissing(facts)[0];
    if (!next) return openFromIntake(service, held, context, report, facts);
    return tell(intakeQuestion({ ask: next, first: false, firm: context.firm, before: known, after: facts }));
  }
  // An answer that already rules the right out ends the intake at once, whatever is still missing (0239): a flight
  // older than 5 years, a notice of 72 hours or more, an arrival less than 4 hours late.
  if (qualify(intakeQualificationInput(facts, today())).outcome === "not_qualified") {
    return decideIntake(service, held, context, report, facts, keep, tell);
  }
  const missing = intakeMissing(facts);
  if (missing.length > 0) {
    if (facts.etapa) await keep({}, ["etapa"]);
    return tell(intakeQuestion({ ask: missing[0], first: !started, firm: context.firm, before: known, after: facts }));
  }
  if (!(await keep({ etapa: "resumo" }))) return false;
  return tell(intakeSummary(facts, await intakeNames(service, facts)));
}

/** The summary confirmed: the rule decides, and a problem that qualifies is offered with the firm's words on its fees. */
async function decideIntake(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  report: TurnReport,
  facts: IntakeFacts,
  keep: Keep,
  tell: Tell,
): Promise<boolean> {
  const verdict = qualify(intakeQualificationInput(facts, today()));
  if (verdict.outcome === "not_qualified") {
    const answer = await rpc(service, "one_intake_not_qualified", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_result: verdict,
      target_body: await wordsOf(service, context.orgId, "not_qualified", notQualifiedMessage(facts.nome ?? ""), {
        nome: greeting(facts.nome ?? ""),
      }),
    });
    if (answer.code === "not_qualified") await send(service, answer.message_id);
    report.answered += 1;
    return true;
  }
  if (verdict.outcome !== "qualifies") {
    // What the rule cannot decide (a change of class, another problem, a fact it lacks): a person of the firm weighs it.
    await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
      () => undefined,
    );
    await callPerson(
      service,
      held,
      "Um passageiro contou um problema que a regra não decide sozinha: uma pessoa do escritório avalia.",
    );
    report.called += 1;
    return true;
  }
  if (!(await keep({ etapa: "oferta" }))) return false;
  const names = await intakeNames(service, facts);
  const fees = await firmMessageText(service, context.orgId, "fees");
  return tell(
    intakeOffer({ airline: names.airline, fees: fees ? fillMessage(fees, { nome: greeting(facts.nome) }) : null }),
  );
}

/** The person's answer to the offer: the case opened, a no kept kindly, the firm's answers to doubts, or a person. */
async function takeOffer(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  report: TurnReport,
  facts: IntakeFacts,
  reply: string,
  keep: Keep,
  tell: Tell,
): Promise<boolean> {
  const choice = choiceOf(facts.etapa === "duvidas" ? OPTIONS.duvidas : OPTIONS.oferta, reply);
  if (choice === "seguir") {
    // Only now ONE asks what is not of the right: how to call them and who travelled along (0239).
    const next = intakePersonalMissing(facts)[0];
    if (!next) return openFromIntake(service, held, context, report, facts);
    const going = await keep({ etapa: "seguir" });
    if (!going) return false;
    return tell(`Combinado. ${questionText(next, going)}`);
  }
  if (choice === "agora_nao") {
    if (!(await keep({ etapa: "recusou" }))) return false;
    const name = facts.nome ?? "";
    return tell(await wordsOf(service, context.orgId, "declined", declinedMessage(name), { nome: greeting(name) }));
  }
  if (facts.etapa === "recusou") {
    // Who said no and writes again is offered again: "Se mudar de ideia, é só escrever aqui".
    return decideIntake(service, held, context, report, facts, keep, tell);
  }
  const faq = facts.etapa === "oferta" ? await firmMessageText(service, context.orgId, "faq") : null;
  if (faq && choice !== "pessoa") {
    if (!(await keep({ etapa: "duvidas" }))) return false;
    return tell(intakeDoubts(fillMessage(faq, { nome: greeting(facts.nome) })));
  }
  await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
    () => undefined,
  );
  await callPerson(
    service,
    held,
    "O passageiro tem uma dúvida antes de seguir com o caso: uma pessoa do escritório responde.",
  );
  report.called += 1;
  return true;
}

/** The person's "Quero seguir": the case opened with the client's link, the documents asked here in the chat. */
async function openFromIntake(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  report: TurnReport,
  facts: IntakeFacts,
): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");
  const url = `${BRAND.siteUrl}/c/${token}`;
  const companions = companionsOf(facts.acompanhantes);
  const children = companions.filter(isChild);
  const adults = companions.filter((companion) => !isChild(companion));
  const answer = await rpc(service, "one_open_case_from_intake", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    target_body: await wordsOf(
      service,
      context.orgId,
      "link_steps",
      intakeOpenedMessage({
        passengerName: facts.nome ?? "",
        firm: context.firm,
        children: children.map((child) => child.name),
        adults: adults.map((adult) => adult.name),
      }),
      { nome: greeting(facts.nome), link: url },
    ),
    // Each child joins the case as a claimant the passenger answers for (0234).
    target_children: children.map((child) => ({ name: child.name, age: child.age })),
  });
  if (answer.code === "opened" || answer.code === "opened_without_link") {
    report.opened += 1;
    if (answer.code === "opened") await send(service, answer.message_id);
    else await say(service, held, caseOpenedNoLinkMessage(facts.nome ?? ""));
    if (typeof answer.case_id === "string") {
      const interviewId = await startInterview(service, answer.case_id).catch(() => null);
      if (interviewId) await advanceInterview(service, interviewId).catch(() => undefined);
    }
    return true;
  }
  if (answer.code === "by_person") {
    await say(service, held, byPersonMessage(facts.nome ?? ""));
    await callPerson(
      service,
      held,
      "Um passageiro quer seguir, e abrir o caso pela conversa espera uma pessoa do escritório.",
    );
    report.called += 1;
    return true;
  }
  if (answer.code === "has_case" || answer.code === "already_opened") {
    // A case of the contact goes on already: ONE's usual answer carries the conversation.
    return false;
  }
  // The facts did not hold (no name the firm's records take, a problem of no kind): a person opens it.
  await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
    () => undefined,
  );
  await callPerson(
    service,
    held,
    "Um passageiro quer seguir, mas o caso não abriu sozinho: uma pessoa do escritório abre.",
  );
  report.called += 1;
  return true;
}

/** The passenger's answer to the alert, kept; a no is ended kindly, a stop in silence. */
async function answerAlert(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  answer: "yes" | "no" | "stop",
  report: TurnReport,
): Promise<void> {
  if (answer === "yes") {
    await openCase(service, held, context, report);
    return;
  }
  const kept = await rpc(service, "answer_flight_alert", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_answer: answer,
  });
  if (kept.ok && answer === "no") {
    const name = context.alert?.passengerName ?? "";
    await say(
      service,
      held,
      await wordsOf(service, context.orgId, "declined", declinedMessage(name), { nome: greeting(name) }),
    );
  }
}

/** One turn of a claimed conversation. Throws when it could not be done now: the turn is given back. */
async function takeTurn(service: SupabaseClient, held: Held, report: TurnReport): Promise<void> {
  const context = turnContextOf(
    await rpc(service, "conversation_turn_context", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
    }),
  );
  if (!context) return;

  // Who went to a hearing for the firm reports its result here (0187): a member by the WhatsApp of their profile, or an
  // attendee from outside by the one on the hearing. Anybody else is answered as usual.
  if (
    await takeHearingReport(service, held, context, lastClientWords(context.messages), (body) =>
      say(service, held, body),
    ).catch(() => false)
  ) {
    report.answered += 1;
    return;
  }

  // What the passenger sent as files joins the case before anything is answered.
  const joinedFiles = await joinFiles(service, held, context);

  // The client's word ONE asked in the chat: free justice, the civil court, the facts of the action (0233).
  {
    const reply = lastClientWords(context.messages).join(" ");
    const took =
      !joinedFiles &&
      ((await takeChatQuestion(service, held, context, reply, report).catch(() => false)) ||
        (await takeFactsAnswer(service, held, context, reply).catch(() => false)));
    if (took) {
      report.answered += 1;
      await rpc(service, "record_conversation_turn", {
        target_conversation: held.conversationId,
        target_claim: held.claim,
        target_through: context.through,
      });
      return;
    }
  }

  // The client's answer while the check of their data waits for one (0232).
  if (
    !joinedFiles &&
    (await takeDataCheck(service, held, context, lastClientWords(context.messages).join(" ")).catch(() => false))
  ) {
    report.answered += 1;
    await rpc(service, "record_conversation_turn", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_through: context.through,
    });
    return;
  }

  // The client's "Não tenho" to the dispensable documents ONE asked (0230).
  if (
    !joinedFiles &&
    (await takeNotHave(service, held, context, lastClientWords(context.messages).join(" ")).catch(() => false))
  ) {
    report.answered += 1;
    await rpc(service, "record_conversation_turn", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_through: context.through,
    });
    return;
  }

  // ONE asked here what the client's account is missing (0092): what they write now is their answer, unless it is
  // their plain answer to an alert.
  const replied = lastClientWords(context.messages);

  // The interview of their case (0095): what they write now answers the question that waits, one at a time. A
  // question of theirs is ONE's to answer first, and the question that waits is asked again after it. A read that
  // fails here never stops the turn: ONE answers as it would without it.
  const lastWord = replied.length > 0 ? quickAnswer(replied[replied.length - 1]) : null;
  let interviewTook = false;
  let interviewBack: string | null = null;
  if (!(context.alert && lastWord) && lastWord !== "stop") {
    const found = await rpc(service, "conversation_interview", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
    }).catch((): Record<string, unknown> => ({}));
    const view =
      typeof found.interview_id === "string"
        ? await readInterview(service, { interviewId: found.interview_id }).catch(() => null)
        : null;
    if (view && view.status === "open") {
      if (replied.length > 0) {
        const outcome = await answerInterview(service, {
          orgId: context.orgId,
          view,
          words: replied,
          key: `${held.conversationId}:${held.claim}`,
        }).catch(() => "none" as const);
        if (outcome === "question") interviewBack = view.id;
        else if (outcome !== "none") {
          interviewTook = true;
          report.answered += 1;
        }
      } else if (joinedFiles) {
        interviewTook = await answerWithPaper(service, view).catch(() => false);
      }
    }
  }
  // A read that fails here never stops the turn: ONE answers the conversation as it would without it.
  const open = await rpc(service, "conversation_account_open", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  }).catch((): Record<string, unknown> => ({}));
  const alertAnswer = context.alert && replied.length > 0 ? quickAnswer(replied[replied.length - 1]) : null;
  const statementId = open.code === "open" && typeof open.statement_id === "string" ? open.statement_id : null;
  let answeredAccount = false;
  if (
    !interviewTook &&
    !interviewBack &&
    statementId &&
    replied.length > 0 &&
    !alertAnswer &&
    quickAnswer(replied[replied.length - 1]) !== "stop"
  ) {
    answeredAccount = await takeAccountAnswer(
      service,
      held,
      context,
      statementId,
      typeof open.first_name === "string" ? open.first_name : "",
    ).catch(() => false);
    if (answeredAccount) report.answered += 1;
  }

  if (answeredAccount || interviewTook) {
    // The reply was the account's, or the interview's: nothing else of it waits for an answer.
  } else if (context.answersLastHour >= ANSWERS_PER_HOUR) {
    await callPerson(service, held, "Muitas mensagens em pouco tempo: uma pessoa do escritório continua a conversa.");
    report.called += 1;
  } else {
    const words = lastClientWords(context.messages);
    const quick = context.alert && words.length > 0 ? quickAnswer(words[words.length - 1]) : null;
    if (context.alert && quick) {
      await answerAlert(service, held, context, quick, report);
    } else if (
      words.length > 0 &&
      !context.alert &&
      context.cases.length === 0 &&
      (await takeIntake(service, held, context, report))
    ) {
      // ONE took them in (0176): asked what is missing, or decided.
    } else if (words.length > 0) {
      const run = await runFirmTask({
        orgId: context.orgId,
        task: CONVERSATION_TASK,
        input: modelInput(context),
        subject: { type: "wa_conversation", id: held.conversationId },
        idempotencyKey: `${held.conversationId}:${held.claim}`,
      });
      if (run.kind !== "finished") {
        // A model that did not answer now: a person carries the conversation on rather than the passenger waiting.
        await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
          () => undefined,
        );
        await callPerson(service, held, "O ONE não conseguiu responder agora.");
        report.called += 1;
      } else {
        const answer = modelAnswerOf(run.output);
        if (
          answer &&
          context.alert &&
          (answer.intent === "sim" || answer.intent === "nao" || answer.intent === "parar")
        ) {
          await answerAlert(
            service,
            held,
            context,
            answer.intent === "sim" ? "yes" : answer.intent === "nao" ? "no" : "stop",
            report,
          );
        } else if (run.approvalId) {
          // The firm keeps ONE's answers to a person: this one waits in the queue for "Enviar".
        } else {
          const drafted = cleanReply(answer?.reply);
          // What the bar's rules on advertising weigh (a promise, a price, pressure) never goes as ONE's own word: a
          // person of the firm continues (`publicidade-v1`).
          const flagged = drafted ? checkMessage(drafted) : [];
          const reply = flagged.length > 0 ? null : drafted;
          if (flagged.length > 0) {
            await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
              () => undefined,
            );
            await callPerson(
              service,
              held,
              "A resposta do ONE falaria de resultado, de preço ou pediria pressa: uma pessoa do escritório responde.",
            );
            report.called += 1;
          } else if (reply) {
            const sent = await rpc(service, "one_reply", {
              target_conversation: held.conversationId,
              target_claim: held.claim,
              target_run: run.runId,
              target_body: reply,
            });
            if (sent.ok) {
              report.answered += 1;
              await send(service, sent.message_id);
            }
          }
          if (flagged.length === 0 && (!answer || answer.callPerson || answer.intent === "parar")) {
            if (!reply)
              await say(service, held, await wordsOf(service, context.orgId, "called_person", calledMessage)).catch(
                () => undefined,
              );
            await callPerson(
              service,
              held,
              answer?.callPerson ??
                (answer?.intent === "parar"
                  ? "O passageiro pediu para não receber mais mensagens."
                  : "O ONE não entendeu o que responder."),
            );
            report.called += 1;
          }
        }
      }
    }
  }

  // ONE answered what the passenger asked in the middle of the interview: the question that waits is asked again.
  if (interviewBack) await advanceInterview(service, interviewBack, "back").catch(() => undefined);

  await rpc(service, "record_conversation_turn", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_through: context.through,
  });
}

/** Takes the turns due: one conversation named, or the oldest. Throws only when nothing could be claimed at all. */
export async function takeConversationTurns(
  service: SupabaseClient,
  options: { conversationId?: string | null; limit?: number } = {},
): Promise<TurnReport> {
  const report: TurnReport = { claimed: 0, answered: 0, opened: 0, called: 0, failed: 0 };
  const { data, error } = await service.rpc("claim_conversation_turns", {
    target_limit: options.limit ?? 10,
    target_conversation: options.conversationId ?? null,
  });
  if (error) throw new Error("conversation turns could not be claimed");
  const claimed = (Array.isArray(data) ? data : []) as { conversation_id: string; claim: number }[];
  report.claimed = claimed.length;
  for (const row of claimed) {
    const held = { conversationId: row.conversation_id, claim: Number(row.claim) };
    try {
      await takeTurn(service, held, report);
    } catch {
      report.failed += 1;
      await service
        .rpc("release_conversation_turn", { target_conversation: held.conversationId, target_claim: held.claim })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }
  return report;
}

/** How long a passenger's messages one after the other are gathered before ONE answers. */
export const GATHER_MS = 5_500;

/**
 * A passenger just wrote: the answer is taken right after the response, a
 * few seconds later, so messages written one after the other are answered
 * together (the database claims the conversation's turn, so the requests of
 * each of them answer once). Never waited for: the sweep takes it anyway.
 */
export async function queueConversationTurn(conversationId: string): Promise<void> {
  soon("conversation-turn", async () => {
    await new Promise((resolve) => setTimeout(resolve, GATHER_MS));
    await takeConversationTurns(createServiceClient(), { conversationId });
  });
}

/**
 * An answer of ONE a person approved: sent now. Never throws: answers what
 * became of it (`queued`, `already_sent`, or why it did not go, as the
 * database says it: `window_closed`, `opted_out`, `number_disconnected`).
 */
export async function sendApprovedReply(approvalId: string): Promise<string> {
  try {
    const service = createServiceClient();
    const answer = await rpc(service, "one_send_approved_reply", { target_approval: approvalId });
    if (!answer.ok) return typeof answer.code === "string" ? answer.code : "failed";
    await send(service, answer.message_id);
    return typeof answer.code === "string" ? answer.code : "queued";
  } catch {
    return "failed";
  }
}
