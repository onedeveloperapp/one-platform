"use client";

import ClientCivilCourt from "./client-civil-court";
import ClientCourse from "./client-course";
import ClientNotices from "./client-notices";
import ClientStatements from "./client-statements";
import { ClientSignatures, ClientTerms } from "./client-tasks";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import SegmentFields from "@/components/cases/segment-fields";
import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine, { type StateTone } from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiCheck from "@/icons/nexture/ni-check";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiDocumentPlus from "@/icons/nexture/ni-document-plus";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPlane from "@/icons/nexture/ni-plane";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { accountAsksClient } from "@/lib/cases/account";
import {
  caseErrorKey,
  caseLabel,
  CLIENT_DOCUMENT_KINDS,
  DOCUMENT_KIND_KEY,
  DOCUMENT_STATUS_KEY,
  type DocumentKind,
  type DocumentNeed,
  documentNeeds,
  documentsFor,
  FILE_REFUSAL_KEY,
  formatLocalTime,
  missingItems,
  PERSON_FIELD_KEY,
} from "@/lib/cases/cases";
import {
  documentsStanding,
  extraDocuments,
  isOwed,
  latestRefusal,
  type NeedStanding,
  needStanding,
} from "@/lib/cases/client-documents";
import type { ClientLinkView, ClientPerson, ClientTasks } from "@/lib/cases/client-link";
import {
  addClientDependent,
  assignClientUpload,
  discardClientUpload,
  finishClientLink,
  finishClientUpload,
  readClientChildDocument,
  removeClientSegment,
  saveClientPerson,
  saveClientSegment,
  startClientUpload,
} from "@/lib/cases/client-link-actions";
import { documentReadingOf } from "@/lib/cases/document-prefill";
import { CLIENT_PHOTO_PROBLEM_KEY, isPhotoProblem, PHOTO_POOR, type PhotoProblem } from "@/lib/cases/document-quality";
import {
  ADULT_FORM,
  MINOR_FORM,
  type PersonField,
  personFields,
  type PersonValues,
  personValues,
  segmentFields,
  type SegmentValues,
  segmentValues,
} from "@/lib/cases/forms";
import { beingRead, READ_ITEM_KEY, readFieldsOf, readItems } from "@/lib/cases/read-fields";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { formatDayBr, isMinorOn } from "@flyee/rules/person";

type OpenView = Extract<ClientLinkView, { state: "open" }>;
type Problem = { code: string; field?: string | null } | null;
/** A photo the client sent that is hard to read: the upload that waits, what it is of, and what is wrong with it. */
type PoorPhoto = { kind: DocumentKind; partyId: string | null; documentId: string; problems: PhotoProblem[] };
/** What a photo sent all the same may be answered while it is still there to send: it could not be sent now. */
const STILL_THERE: ReadonlySet<string> = new Set([PHOTO_POOR, "failed", "unavailable"]);

/** While a document sent in the last minutes waits for the firm, the folder is read again this often, for this long. */
const CHECK_POLL_MS = 10_000;
const CHECK_WATCH_MS = 5 * 60_000;
/** How a document the firm needs stands, in its colour and in its words, on its line of the documents. */
const NEED_LOOK: Record<NeedStanding, { tone: StateTone; key: string }> = {
  accepted: { tone: "done", key: DOCUMENT_STATUS_KEY.accepted },
  received: { tone: "waiting", key: "client-documents-in-check" },
  rejected: { tone: "attention", key: DOCUMENT_STATUS_KEY.rejected },
  missing: { tone: "attention", key: "client-documents-needed" },
};
/** The files a link still takes are said once they are few: a client far from the ceiling has nothing to weigh. */
const FEW_UPLOADS_LEFT = 5;
/** The line of a document of another kind than the ones the firm needs: its form, or the way to it. */
const OTHER = "other";

/**
 * What a client does on their link: their data and the data of the children
 * who flew with them, the legs of the trip, the documents, and the word that
 * they finished. Each save goes to the database through the link's own
 * functions and the page is read again, so what the client sees is what the
 * firm sees.
 */
export default function ClientFolder({
  token,
  view,
  tasks,
  today,
}: {
  token: string;
  view: OpenView;
  /** What the link asks the client to sign, to accept and to confirm, and what it tells them of their lawsuits. */
  tasks: ClientTasks;
  today: string;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const editable = view.case.editable;

  // ONE checks a document in a moment after it arrives: while one sent in the last minutes waits, the folder is
  // read again, so a refusal and its reason are said here while the client still has the paper in hand.
  const lastWaiting = view.documents.reduce(
    (latest, document) =>
      document.status === "received" ? Math.max(latest, Date.parse(document.created_at) || 0) : latest,
    0,
  );
  useEffect(() => {
    if (lastWaiting === 0) return;
    // The window is the document's and also this page's own: a phone whose clock is wrong never reads without end.
    const started = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now - lastWaiting > CHECK_WATCH_MS || now - started > CHECK_WATCH_MS) {
        window.clearInterval(timer);
        return;
      }
      if (window.document.visibilityState === "visible") router.refresh();
    }, CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [lastWaiting, router]);

  // ONE prepares what the client signs right after they say they finished (the power of attorney, the contract):
  // for a few minutes the folder is read again, so the papers show while the client is still here.
  const finishedAt = Date.parse(view.link.finished_at ?? "") || 0;
  const awaitingPapers = finishedAt > 0 && tasks.signatures.length === 0;
  useEffect(() => {
    if (!awaitingPapers) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now - finishedAt > CHECK_WATCH_MS || now - started > CHECK_WATCH_MS) {
        window.clearInterval(timer);
        return;
      }
      if (window.document.visibilityState === "visible") router.refresh();
    }, CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [awaitingPapers, finishedAt, router]);

  const holder = view.people.find((person) => person.is_holder) ?? view.people[0];
  const claimants = view.people.filter((person) => person.roles.includes("claimant"));
  const missing = holder
    ? missingItems({
        holder,
        holderPartyIds: holder.party_ids,
        claimants,
        documents: view.documents,
        segments: view.segments.length,
        required: view.required_documents,
        today,
      })
    : [];

  // The client's account of what happened is asked here too, while it is theirs to give (0090).
  const accountAsk = accountAsksClient(tasks.account);

  const kindKey = caseKindLabelKey(view.case.incident);
  const facts = [
    caseLabel(view.case.seq),
    kindKey ? t(kindKey) : null,
    view.case.airline?.name ?? null,
    view.case.flight_date ? formatDayBr(view.case.flight_date) : null,
  ].filter(Boolean);

  return (
    <>
      <Card component="header">
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h1" component="h1" className="mb-0 break-words">
            {t("client-title", { firm: view.firm })}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {facts.join(" · ")}
          </Typography>
          <Typography variant="body1" className="text-text-primary">
            {editable ? t("client-intro") : tasks.course.length > 0 ? t("client-locked-court") : t("client-locked")}
          </Typography>
          {editable && tasks.agency && (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("client-agency-confirm", { agency: tasks.agency })}
            </Alert>
          )}
        </CardContent>
      </Card>

      {editable && (
        <Card component="section" aria-labelledby="client-missing">
          <CardContent className="flex flex-col gap-3">
            <Typography id="client-missing" variant="h5" component="h2" className="mb-0">
              {t("client-missing-title")}
            </Typography>
            {missing.length === 0 && !accountAsk ? (
              <Alert severity="success" className="neutral bg-background-paper/60!">
                {t("client-missing-none")}
              </Alert>
            ) : (
              <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
                {missing.map((item, index) => (
                  <Typography key={index} component="li" variant="body1">
                    {item.type === "fields"
                      ? t("client-missing-fields", { name: item.name })
                      : item.type === "flight"
                        ? t("client-missing-flight")
                        : item.name
                          ? t("client-missing-document", { document: t(DOCUMENT_KIND_KEY[item.kind]), name: item.name })
                          : t(DOCUMENT_KIND_KEY[item.kind])}
                  </Typography>
                ))}
                {accountAsk && (
                  <Typography component="li" variant="body1">
                    {accountAsk === "tell" ? t("client-missing-account") : t("client-missing-account-answer")}
                  </Typography>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      <ClientCourse lawsuits={tasks.course} />
      <ClientTerms token={token} terms={tasks.terms} onSaved={() => router.refresh()} />
      <ClientCivilCourt token={token} items={tasks.civilCourt} onSaved={() => router.refresh()} />
      {/* The documents first: ONE reads the data of each person and the trip in them (migration 0063). */}
      <Documents
        token={token}
        view={view}
        holder={holder}
        claimants={claimants}
        editable={editable}
        onSaved={() => router.refresh()}
      />
      <People
        token={token}
        people={view.people}
        documents={view.documents}
        today={today}
        editable={editable}
        onSaved={() => router.refresh()}
      />
      <Trip token={token} view={view} editable={editable} onSaved={() => router.refresh()} />
      <ClientStatements
        token={token}
        statements={tasks.statements}
        account={tasks.account}
        editable={editable}
        onSaved={() => router.refresh()}
      />
      <ClientNotices token={token} notices={tasks.notices} editable={editable} onSaved={() => router.refresh()} />
      <ClientSignatures token={token} signatures={tasks.signatures} editable onSaved={() => router.refresh()} />
      {editable && (
        <Finish
          token={token}
          finishedAt={view.link.finished_at}
          expiresAt={view.link.expires_at}
          // What the action is prepared from and the client still owes (0090): told before and after they finish.
          owed={OWED_OF_ASK[accountAsk ?? "none"]}
          onSaved={() => router.refresh()}
        />
      )}

      <Typography variant="body2" className="text-text-secondary px-2 text-center">
        {t("client-footer", { firm: view.firm })}
      </Typography>
    </>
  );
}

function ProblemAlert({ problem }: { problem: Problem }) {
  const t = useTranslations("product");
  if (!problem) return null;
  return (
    <Alert severity="error" className="neutral bg-background-paper/60!">
      {t(caseErrorKey(problem.code))}
    </Alert>
  );
}

// ---------- People ----------

function People({
  token,
  people,
  documents,
  today,
  editable,
  onSaved,
}: {
  token: string;
  people: ClientPerson[];
  documents: OpenView["documents"];
  today: string;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<PersonValues>(personValues(null));
  const [initial, setInitial] = useState<PersonValues>(personValues(null));
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });
  // A child starts from their document (0085): ONE reads it into the form, the client confirms, and the document
  // is then the child's. Typing is the contingency.
  const [childDoc, setChildDoc] = useState<{ documentId: string | null; name: string; state: SlotState } | null>(null);
  const [childRead, setChildRead] = useState<ReadonlySet<PersonField>>(new Set());
  const [childManual, setChildManual] = useState(false);
  const [childPoor, setChildPoor] = useState<{ documentId: string; problems: PhotoProblem[] } | null>(null);
  const [childNote, setChildNote] = useState<string | null>(null);

  const sendChildDocument = async (file: File) => {
    const before = childDoc?.documentId ?? null;
    setChildDoc({ documentId: null, name: file.name, state: { kind: "reading" } });
    const fail = (documentId: string | null, key: string) =>
      setChildDoc({ documentId, name: file.name, state: { kind: "failed", sentence: t(key) } });
    const mime = mimeOf(file);
    const started = await startClientUpload(token, {
      kind: "identity",
      partyId: null,
      name: file.name,
      mime,
      bytes: file.size,
    });
    if (!started.ok) return fail(null, caseErrorKey(started.code));
    const uploaded = await uploadToSignedUrl({
      storagePath: started.storagePath,
      uploadToken: started.uploadToken,
      file,
      contentType: mime,
    });
    if (!uploaded) {
      void discardClientUpload(token, started.documentId).catch(() => undefined);
      return fail(null, "client-child-read-failed");
    }
    if (before) void discardClientUpload(token, before).catch(() => undefined);
    const read = await readClientChildDocument(token, started.documentId);
    if (!read.ok) {
      return fail(
        started.documentId,
        read.code === "prefill_limit" ? "client-child-read-limit" : "client-child-read-failed",
      );
    }
    const reading = documentReadingOf(read.output, today);
    const fields = (["full_name", "cpf", "birth_date"] as const).filter((field) => reading.person.values[field]);
    setValues((current) => {
      const next = { ...current };
      for (const field of fields) next[field] = reading.person.values[field] ?? next[field];
      return next;
    });
    setChildRead(new Set(fields));
    setChildDoc({
      documentId: started.documentId,
      name: file.name,
      state:
        fields.length > 0
          ? {
              kind: "read",
              tone: "positive",
              sentence: t("client-child-read-ok", { identified: reading.identified || t("prefill-read-unknown") }),
            }
          : { kind: "read", tone: "attention", sentence: t("client-child-read-nothing") },
    });
  };

  // The child's document sent and never given to a child goes when the client leaves the form.
  const cancelChild = () => {
    if (childDoc?.documentId) void discardClientUpload(token, childDoc.documentId).catch(() => undefined);
    setChildDoc(null);
    setChildRead(new Set());
    setChildManual(false);
    setOpen(null);
  };

  /** The child's document, read before the child was in the case, is theirs now and goes to the firm. */
  const sendToChild = async (documentId: string, partyId: string, insist = false): Promise<void> => {
    if (!insist) {
      const assigned = await assignClientUpload(token, documentId, partyId);
      if (!assigned.ok) return;
    }
    const finished = await finishClientUpload(token, documentId, insist ? { insist: true } : undefined);
    if (!finished.ok && finished.code === PHOTO_POOR) {
      setChildPoor({ documentId, problems: (finished.problems ?? []).filter(isPhotoProblem) });
      return;
    }
    setChildPoor(null);
  };

  const formOf = (person: ClientPerson | null): readonly PersonField[] =>
    !person || isMinorOn(person.birth_date, today) === true ? MINOR_FORM : ADULT_FORM;
  // What ONE read from a document of the person and nobody changed since: said under each field while the
  // value in the form is still the one the document gave.
  const readOf = (person: ClientPerson | null): ReadonlySet<PersonField> => {
    if (!person) return childRead;
    // Compared as the form sends them: a CEP the mask wrote with its dash is the same CEP.
    const changed = new Set(Object.keys(personFields(values, formOf(person), initial)));
    const marks = readFieldsOf(person.read_fields);
    return new Set((Object.keys(marks) as PersonField[]).filter((field) => !changed.has(field)));
  };

  const edit = (person: ClientPerson | null) => {
    const start = personValues(person);
    setValues(start);
    setInitial(start);
    setProblem(null);
    setOpen(person ? person.person_id : "new");
  };

  const save = async (person: ClientPerson | null) => {
    setBusy(true);
    setProblem(null);
    let partyId: string | null = null;
    let result: { ok: boolean; code: string; field?: string | null };
    if (person) {
      result = await saveClientPerson(token, person.person_id, personFields(values, formOf(person), initial));
    } else {
      const added = await addClientDependent(token, personFields(values, MINOR_FORM));
      if (added.ok) partyId = added.partyId;
      result = added;
    }
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field });
      return;
    }
    // The document the child came from is theirs now, and goes to the firm as any other.
    if (!person && childDoc?.documentId && partyId) await sendToChild(childDoc.documentId, partyId);
    setBusy(false);
    setChildDoc(null);
    setChildRead(new Set());
    setChildManual(false);
    setOpen(null);
    onSaved();
  };

  const form = (person: ClientPerson | null) => (
    <Box
      component="form"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(person);
      }}
    >
      <PersonFields
        idPrefix={`client-person-${person?.person_id ?? "new"}`}
        values={values}
        shown={formOf(person)}
        onChange={(next) => {
          if (!person) {
            setChildRead((current) => new Set([...current].filter((field) => next[field] === values[field])));
          }
          setValues(next);
        }}
        errorField={problem?.field}
        errorText={problem ? t(caseErrorKey(problem.code)) : null}
        disabled={busy}
        read={readOf(person)}
      />
      {problem && !problem.field && <ProblemAlert problem={problem} />}
      <Box className="flex flex-wrap gap-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? t("client-working") : person ? t("client-save") : t("client-add-child-submit")}
        </Button>
        <Button variant="text" color="grey" onClick={() => (person ? setOpen(null) : cancelChild())} disabled={busy}>
          {t("client-cancel")}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Card component="section" aria-labelledby="client-people">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="client-people" variant="h5" component="h2" className="mb-0">
            {t("client-people-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-people-body")}
          </Typography>
        </Box>

        {people.map((person) => {
          const minor = isMinorOn(person.birth_date, today) === true;
          const left = formOf(person)
            .filter((field) => field !== "complement" && field !== "email" && field !== "phone")
            .filter((field) => !String(person[field] ?? "").trim());
          const read = readItems(readFieldsOf(person.read_fields));
          const reading = left.length > 0 && beingRead(person.party_ids ?? [person.party_id], documents);
          return (
            <Box key={person.person_id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Box className="flex flex-wrap items-center justify-between gap-2">
                <Box className="flex min-w-0 flex-col">
                  <Typography variant="body1" className="font-semibold break-words">
                    {person.full_name}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {person.is_holder
                      ? t("client-person-you")
                      : minor
                        ? t("client-person-minor")
                        : t("client-person-other")}
                  </Typography>
                </Box>
                <StatusChip
                  tone={left.length === 0 ? "positive" : "attention"}
                  label={
                    left.length === 0 ? t("client-person-complete") : t("client-person-missing", { count: left.length })
                  }
                />
              </Box>
              {left.length > 0 && open !== person.person_id && (
                <Typography variant="body2" className="text-text-secondary">
                  {left.map((field) => t(PERSON_FIELD_KEY[field])).join(" · ")}
                </Typography>
              )}
              {read.length > 0 && open !== person.person_id && (
                <Typography variant="body2" className="text-text-primary">
                  {t("client-person-read", { items: list.format(read.map((item) => t(READ_ITEM_KEY[item]))) })}
                </Typography>
              )}
              {reading && (
                <Typography variant="body2" className="text-text-secondary" role="status">
                  {t("client-person-reading")}
                </Typography>
              )}
              {open === person.person_id
                ? form(person)
                : editable && (
                    <Box>
                      <Button variant="outlined" color="grey" size="small" onClick={() => edit(person)}>
                        {t("client-edit")}
                      </Button>
                    </Box>
                  )}
            </Box>
          );
        })}

        {childPoor && (
          <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
            <Typography variant="body2" component="p" className="mb-1 font-semibold">
              {t("client-photo-poor-title")}
            </Typography>
            {childPoor.problems.length > 0 && (
              <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
                {childPoor.problems.map((item) => (
                  <Typography key={item} component="li" variant="body2">
                    {t(CLIENT_PHOTO_PROBLEM_KEY[item])}
                  </Typography>
                ))}
              </Box>
            )}
            <Typography variant="body2" component="p" className="mt-2">
              {t("client-photo-poor-choice")}
            </Typography>
            <Box className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="contained"
                size="small"
                disabled={busy}
                onClick={() => {
                  void discardClientUpload(token, childPoor.documentId).catch(() => undefined);
                  setChildPoor(null);
                  setChildNote(t("client-child-retake-where"));
                  onSaved();
                }}
              >
                {t("client-photo-retake")}
              </Button>
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await sendToChild(childPoor.documentId, "", true);
                  setBusy(false);
                  onSaved();
                }}
              >
                {t("client-photo-insist")}
              </Button>
            </Box>
          </Alert>
        )}
        {childNote && (
          <Alert severity="info" className="neutral bg-background-paper/60!" onClose={() => setChildNote(null)}>
            {childNote}
          </Alert>
        )}
        {editable &&
          (open === "new" ? (
            <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Typography variant="body1" className="font-semibold">
                {t("client-add-child")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("client-add-child-body")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                <DocumentSlot
                  id="client-child-doc"
                  icon={<NiDocumentFull size="medium" />}
                  title={t("client-child-docs-title")}
                  hint={t("client-child-docs-hint")}
                  state={childDoc?.state ?? { kind: "empty" }}
                  fileName={childDoc?.name}
                  primary
                  disabled={busy}
                  labels={{
                    send: t("prefill-send"),
                    again: t("prefill-again"),
                    sending: t("prefill-sending"),
                    reading: t("prefill-reading"),
                    read: t("prefill-read"),
                    failed: t("prefill-failed"),
                  }}
                  onFile={(file) => void sendChildDocument(file)}
                />
              </Box>
              {childDoc && (childDoc.state.kind === "read" || childDoc.state.kind === "failed") ? (
                <>
                  {childDoc.state.kind === "read" && childRead.size > 0 && (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("client-child-confirm")}
                    </Typography>
                  )}
                  {form(null)}
                </>
              ) : childManual ? (
                form(null)
              ) : (
                <Box className="flex flex-wrap gap-2">
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={busy || childDoc?.state.kind === "reading"}
                    onClick={() => setChildManual(true)}
                  >
                    {t("client-child-manual")}
                  </Button>
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={childDoc?.state.kind === "reading"}
                    onClick={cancelChild}
                  >
                    {t("client-cancel")}
                  </Button>
                </Box>
              )}
            </Box>
          ) : (
            <Box>
              <Button variant="text" onClick={() => edit(null)}>
                {t("client-add-child")}
              </Button>
            </Box>
          ))}
      </CardContent>
    </Card>
  );
}

// ---------- The trip ----------

function Trip({
  token,
  view,
  editable,
  onSaved,
}: {
  token: string;
  view: OpenView;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<SegmentValues>(segmentValues(null));
  // A ticket or a boarding pass the client sent that is still being checked: its flights are on their way here.
  const ticketOnItsWay = view.documents.some(
    (document) => (document.kind === "ticket" || document.kind === "boarding_pass") && document.status === "received",
  );
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);

  const edit = (segment: OpenView["segments"][number] | null) => {
    setValues(segmentValues(segment));
    setProblem(null);
    setOpen(segment ? segment.id : "new");
  };

  const save = async (segmentId: string | null) => {
    setBusy(true);
    setProblem(null);
    const result = await saveClientSegment(token, segmentId, segmentFields(values));
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    setOpen(null);
    onSaved();
  };

  const remove = async (segmentId: string) => {
    setBusy(true);
    setProblem(null);
    const result = await removeClientSegment(token, segmentId);
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code });
      return;
    }
    onSaved();
  };

  const form = (segmentId: string | null) => (
    <Box
      component="form"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(segmentId);
      }}
    >
      <SegmentFields
        idPrefix={`client-segment-${segmentId ?? "new"}`}
        values={values}
        onChange={setValues}
        errorField={problem?.field}
        errorText={problem ? t(caseErrorKey(problem.code)) : null}
        disabled={busy}
      />
      {problem && !problem.field && <ProblemAlert problem={problem} />}
      <Box className="flex flex-wrap gap-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? t("client-working") : t("client-save")}
        </Button>
        <Button variant="text" color="grey" onClick={() => setOpen(null)} disabled={busy}>
          {t("client-cancel")}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Card component="section" aria-labelledby="client-trip">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="client-trip" variant="h5" component="h2" className="mb-0">
            {t("client-trip-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-trip-body")}
          </Typography>
        </Box>

        {view.segments.length === 0 && open !== "new" && (
          // The flights come from the trip's document, which ONE reads (0085): sent in the documents above, its legs
          // enter here once it is checked. Typing a leg is the contingency.
          <EmptyState
            icon={<NiPlane />}
            title={t("client-trip-empty-title")}
            description={ticketOnItsWay ? t("client-trip-reading") : t("client-trip-empty-docs")}
            action={
              editable && !ticketOnItsWay
                ? {
                    label: t("client-trip-send-ticket"),
                    onClick: () =>
                      document
                        .getElementById("client-documents")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  }
                : undefined
            }
            secondaryAction={editable ? { label: t("client-trip-manual"), onClick: () => edit(null) } : undefined}
          />
        )}

        {view.segments.map((segment) => (
          <Box key={segment.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-center justify-between gap-2">
              <Box className="flex min-w-0 flex-col">
                <Typography variant="body1" className="font-semibold">
                  {[segment.flight_number, [segment.origin_iata, segment.destination_iata].filter(Boolean).join(" → ")]
                    .filter(Boolean)
                    .join(" · ") || t("client-trip-leg", { position: segment.position })}
                </Typography>
                {segment.scheduled_departure_local && (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("client-trip-departure", { time: formatLocalTime(segment.scheduled_departure_local) })}
                  </Typography>
                )}
              </Box>
              {segment.affected && <StatusChip tone="attention" label={t("client-trip-affected")} />}
            </Box>
            {open === segment.id
              ? form(segment.id)
              : editable && (
                  <Box className="flex flex-wrap gap-2">
                    <Button variant="outlined" color="grey" size="small" onClick={() => edit(segment)}>
                      {t("client-edit")}
                    </Button>
                    {segment.source === "client" && (
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={busy}
                        onClick={() => void remove(segment.id)}
                      >
                        {t("client-trip-remove")}
                      </Button>
                    )}
                  </Box>
                )}
          </Box>
        ))}

        {problem && open === null && <ProblemAlert problem={problem} />}

        {editable &&
          (open === "new" ? (
            <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">{form(null)}</Box>
          ) : (
            view.segments.length > 0 && (
              <Box>
                <Button variant="text" onClick={() => edit(null)}>
                  {t("client-trip-add")}
                </Button>
              </Box>
            )
          ))}
      </CardContent>
    </Card>
  );
}

// ---------- Documents ----------

function Documents({
  token,
  view,
  holder,
  claimants,
  editable,
  onSaved,
}: {
  token: string;
  view: OpenView;
  holder: ClientPerson | undefined;
  claimants: ClientPerson[];
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  // What is on its way, by the line it is sent from: a file the client chose, or a photo sent all the same.
  const [busy, setBusy] = useState<{ key: string; insist: boolean } | null>(null);
  // What went wrong, said on the line it happened on.
  const [problem, setProblem] = useState<{ key: string; code: string } | null>(null);
  const [otherKind, setOtherKind] = useState<DocumentKind>("receipt");
  const [otherParty, setOtherParty] = useState<string>(holder?.party_id ?? "");
  // The form of a document of another kind: opened from "Enviar outro documento", closed once its file arrived.
  const [otherOpen, setOtherOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<{ key: string; kind: DocumentKind; partyId: string | null } | null>(null);
  // The photos the client sent that are hard to read, each said under the line it was sent from, with the two
  // ways on. One per line: what is said of one document's photo stays while the client sends another's.
  const [poor, setPoor] = useState<Record<string, PoorPhoto>>({});
  const forget = (key: string) =>
    setPoor((current) => Object.fromEntries(Object.entries(current).filter(([line]) => line !== key)));
  // The lines of the list, and the one the reader is put back on once what they started there ended: on its
  // first button that can be pressed (of the notice, when one is there), or on the line itself. The button
  // they pressed was switched off meanwhile, or gave way to a notice, and a browser may have let go of it.
  // Only a reader who is still among the documents, or nowhere: one who went on to write somewhere else on
  // the page while a photo travelled is left where they are, and the page is never moved under them.
  const card = useRef<HTMLDivElement | null>(null);
  const lines = useRef<Record<string, HTMLElement | null>>({});
  const back = useRef<string | null>(null);
  // The form of another kind, just opened, puts the reader on its first choice: the kind of the document.
  const opening = useRef(false);
  useEffect(() => {
    if (back.current === null) return;
    const line = lines.current[back.current];
    back.current = null;
    const first = opening.current ? line?.querySelector<HTMLElement>('[role="combobox"]') : null;
    opening.current = false;
    const active = window.document.activeElement;
    if (active && active !== window.document.body && !card.current?.contains(active)) return;
    (first ?? line?.querySelector<HTMLElement>("button:not(:disabled)") ?? line)?.focus({ preventScroll: true });
  });

  // One line per document the setting asks for, per person when it is per person: the same needs
  // as "what is still missing" above, so the two never disagree.
  const needs: DocumentNeed[] = holder
    ? documentNeeds({ holder, holderPartyIds: holder.party_ids, claimants, required: view.required_documents })
    : [];
  // A file sent for a need goes to its first party: the person's own, or the whole case.
  const partyOf = (need: DocumentNeed) => need.partyIds?.[0] ?? null;

  // Choosing a file changes nothing yet: a client who closes the window without one keeps what they had,
  // the photo that waits and the choice to send it included.
  const pick = (key: string, kind: DocumentKind, partyId: string | null) => {
    target.current = { key, kind, partyId };
    setProblem(null);
    input.current?.click();
  };

  const send = async (file: File) => {
    const chosen = target.current;
    if (!chosen) return;
    const fail = (code: string) => setProblem({ key: chosen.key, code });
    setBusy({ key: chosen.key, insist: false });
    setProblem(null);
    try {
      const mime = mimeOf(file);
      const started = await startClientUpload(token, {
        kind: chosen.kind,
        partyId: chosen.partyId,
        name: file.name,
        mime,
        bytes: file.size,
      });
      if (!started.ok) return fail(started.code);
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) return fail("not_uploaded");
      const finished = await finishClientUpload(token, started.documentId);
      // A photo hard to read is no error: the client takes another, or sends this one all the same.
      if (!finished.ok && finished.code !== PHOTO_POOR) return fail(finished.code);
      // The new photo arrived: the one it takes the place of is taken back now, so that nothing of it waits
      // in storage. Not before: a photo that did not arrive leaves the client the one they had.
      const replaced = poor[chosen.key];
      if (replaced) void discardClientUpload(token, replaced.documentId).catch(() => undefined);
      if (finished.ok) {
        if (replaced) forget(chosen.key);
        // The document of another kind arrived: it is on the list now, and its form closes.
        if (chosen.key === OTHER) setOtherOpen(false);
        return;
      }
      const waiting: PoorPhoto = {
        kind: chosen.kind,
        partyId: chosen.partyId,
        documentId: started.documentId,
        problems: (finished.problems ?? []).filter(isPhotoProblem),
      };
      setPoor((current) => ({ ...current, [chosen.key]: waiting }));
    } catch {
      // A request that failed on the way (the network, the server): the button comes back.
      fail("not_uploaded");
    } finally {
      setBusy(null);
      back.current = chosen.key;
      onSaved();
    }
  };

  // The photo that was measured is sent as it is: it is still where the link put it.
  const insist = async (key: string) => {
    const waiting = poor[key];
    if (!waiting) return;
    setBusy({ key, insist: true });
    setProblem(null);
    try {
      const finished = await finishClientUpload(token, waiting.documentId, { insist: true });
      if (finished.ok) {
        forget(key);
        if (key === OTHER) setOtherOpen(false);
      } else if (STILL_THERE.has(finished.code)) {
        // It could not be sent now: the photo is still where it was, and so is the choice.
        setProblem({ key, code: finished.code === PHOTO_POOR ? "failed" : finished.code });
      } else {
        // The upload is no longer there to send (the link let go of it, or the file was refused): the client
        // chooses the photo again.
        forget(key);
        setProblem({ key, code: finished.code });
      }
    } catch {
      setProblem({ key, code: "failed" });
    } finally {
      setBusy(null);
      back.current = key;
      onSaved();
    }
  };

  // What went wrong on a line, said on that line: beside what the client was doing, not under the whole list.
  const problemOf = (key: string) => (problem?.key === key ? <ProblemAlert problem={{ code: problem.code }} /> : null);

  // What is said of a photo hard to read, under the line it was sent from. The line's own button gave way
  // to it, and the first of its two ways on is where the reader is put (`back`).
  const poorNotice = (key: string) => {
    const waiting = poor[key];
    if (!waiting) return null;
    const retaking = busy?.key === key && busy.insist === false;
    const insisting = busy?.key === key && busy.insist === true;
    return (
      <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
        <Typography variant="body2" component="p" className="mb-1 font-semibold">
          {t("client-photo-poor-title")}
        </Typography>
        {waiting.problems.length > 0 && (
          <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
            {waiting.problems.map((item) => (
              <Typography key={item} component="li" variant="body2">
                {t(CLIENT_PHOTO_PROBLEM_KEY[item])}
              </Typography>
            ))}
          </Box>
        )}
        <Typography variant="body2" component="p" className="mt-2">
          {t("client-photo-poor-choice")}
        </Typography>
        <Box className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="contained"
            size="small"
            disabled={busy !== null}
            onClick={() => pick(key, waiting.kind, waiting.partyId)}
          >
            {retaking ? t("client-documents-sending") : t("client-photo-retake")}
          </Button>
          <Button
            variant="outlined"
            color="grey"
            size="small"
            disabled={busy !== null}
            onClick={() => void insist(key)}
          >
            {insisting ? t("client-documents-sending") : t("client-photo-insist")}
          </Button>
        </Box>
      </Alert>
    );
  };

  const refusal = (reason: string | null) =>
    reason ? (FILE_REFUSAL_KEY[reason] ? t(FILE_REFUSAL_KEY[reason]) : reason) : "";

  const people = view.people.filter((person) => person.party_id);
  const standing = documentsStanding(needs, view.documents);
  // What was sent that answers no need (a receipt, a photo of what happened): listed after the needs, as it came.
  const extras = extraDocuments(needs, view.documents);
  const nameOf = (partyId: string | null) =>
    partyId ? (view.people.find((person) => person.party_id === partyId)?.full_name ?? null) : null;
  const kindOf = (kind: string) => t(DOCUMENT_KIND_KEY[kind as DocumentKind] ?? DOCUMENT_KIND_KEY.other);

  const openOther = () => {
    setProblem(null);
    setOtherOpen(true);
    opening.current = true;
    back.current = OTHER;
  };
  const closeOther = () => {
    setProblem(null);
    setOtherOpen(false);
    back.current = OTHER;
  };
  // What was sent and serves may be sent again, one click away, never as a button that asks for it again; a
  // document of another kind opens its form.
  const again: QuickAction[] = needs
    .filter((need) => !isOwed(needStanding(documentsFor(need, view.documents))))
    .map((need) => ({
      key: need.key,
      label: need.name
        ? t("client-documents-again-of", { document: t(DOCUMENT_KIND_KEY[need.kind]), name: need.name })
        : t(DOCUMENT_KIND_KEY[need.kind]),
      icon: <NiDocumentPlus size="medium" />,
      disabled: busy !== null,
      onClick: () => pick(need.key, need.kind, partyOf(need)),
    }));
  // A photo that waits in the form still has its two ways on when the case no longer takes new files.
  const showOther = (editable && otherOpen) || Boolean(poor[OTHER]) || problem?.key === OTHER;
  const left =
    view.link.uploads_left <= FEW_UPLOADS_LEFT ? (
      <Typography variant="body2" className="text-text-secondary">
        {t("client-documents-left", { count: view.link.uploads_left })}
      </Typography>
    ) : null;

  const chip =
    standing.state === "owed" ? (
      <StatusChip tone="attention" label={t("client-documents-owed", { count: standing.owed })} />
    ) : standing.state === "checking" ? (
      <StatusChip tone="info" label={t("client-documents-in-check")} />
    ) : standing.state === "complete" ? (
      <StatusChip tone="positive" label={t("client-documents-complete-chip")} />
    ) : null;

  return (
    <Card ref={card} component="section" aria-labelledby="client-documents">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="client-documents"
          icon={<NiDocumentFull size="medium" />}
          tone="secondary"
          title={t("client-documents-title")}
          chip={chip}
          description={standing.state === "owed" || standing.state === "none" ? t("client-documents-body") : undefined}
        />
        {/* Nothing left for the client to send: the card says so first, and what was sent stays listed under it. */}
        {standing.state === "checking" && (
          <StateLine tone="waiting" emphasis>
            {t("client-documents-checking")}
          </StateLine>
        )}
        {standing.state === "complete" && (
          <StateLine tone="done" emphasis>
            {t("client-documents-complete")}
          </StateLine>
        )}

        <input
          ref={input}
          type="file"
          hidden
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void send(file);
          }}
        />

        {/* One line per document: what it is and whose, how it stands on the right, and a button only where a
            file is still owed. */}
        {needs.length + extras.length > 0 && (
          <Box component="ul" className="divide-grey-100 m-0 flex list-none flex-col divide-y p-0">
            {needs.map((need) => {
              const sent = documentsFor(need, view.documents);
              const state = needStanding(sent);
              const sending = busy?.key === need.key && !busy.insist;
              const refused = state === "rejected" ? latestRefusal(sent) : null;
              return (
                <Box
                  component="li"
                  key={need.key}
                  ref={(line: HTMLElement | null) => {
                    lines.current[need.key] = line;
                  }}
                  tabIndex={-1}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <StateLine
                    tone={sending ? "waiting" : NEED_LOOK[state].tone}
                    icon={sending ? <NiUploadCloud size="medium" /> : undefined}
                    status={sending ? t("client-documents-sending") : t(NEED_LOOK[state].key)}
                    action={
                      editable && isOwed(state) && !poor[need.key] ? (
                        <Button
                          variant="contained"
                          size="small"
                          disabled={busy !== null}
                          onClick={() => pick(need.key, need.kind, partyOf(need))}
                        >
                          {state === "rejected" ? t("client-documents-send-more") : t("client-documents-send")}
                        </Button>
                      ) : undefined
                    }
                  >
                    <DocumentWords
                      kind={t(DOCUMENT_KIND_KEY[need.kind])}
                      name={need.name}
                      detail={refused?.rejected_reason ? refusal(refused.rejected_reason) : null}
                    />
                  </StateLine>
                  {poorNotice(need.key)}
                  {problemOf(need.key)}
                </Box>
              );
            })}
            {extras.map((document) => {
              const state = needStanding([document]);
              const reason = document.status === "rejected" && document.rejected_reason;
              return (
                <Box component="li" key={document.id} className="py-3 first:pt-0 last:pb-0">
                  <StateLine tone={NEED_LOOK[state].tone} status={t(NEED_LOOK[state].key)}>
                    {/* Several of a kind are told apart by the file each came in. */}
                    <DocumentWords
                      kind={kindOf(document.kind)}
                      name={nameOf(document.party_id)}
                      detail={reason ? refusal(reason) : document.name}
                      oneLine={!reason}
                    />
                  </StateLine>
                </Box>
              );
            })}
          </Box>
        )}

        {showOther ? (
          <Box
            ref={(line: HTMLElement | null) => {
              lines.current[OTHER] = line;
            }}
            tabIndex={-1}
            className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
          >
            <Typography variant="body2" component="h3" className="font-semibold">
              {t("client-documents-other")}
            </Typography>
            {editable && (
              <Box className="flex flex-col gap-3 sm:flex-row">
                <TextField
                  select
                  size="small"
                  fullWidth
                  id="client-other-kind"
                  label={t("client-documents-kind")}
                  value={otherKind}
                  // A photo that waits here was sent as a kind and for a person: they stay what the choice is about.
                  disabled={Boolean(poor[OTHER])}
                  onChange={(event) => setOtherKind(event.target.value as DocumentKind)}
                >
                  {CLIENT_DOCUMENT_KINDS.map((kind) => (
                    <MenuItem key={kind} value={kind}>
                      {t(DOCUMENT_KIND_KEY[kind])}
                    </MenuItem>
                  ))}
                </TextField>
                {people.length > 1 && (
                  <TextField
                    select
                    size="small"
                    fullWidth
                    id="client-other-person"
                    label={t("client-documents-person")}
                    value={otherParty}
                    disabled={Boolean(poor[OTHER])}
                    onChange={(event) => setOtherParty(event.target.value)}
                  >
                    {people.map((person) => (
                      <MenuItem key={person.person_id} value={person.party_id ?? ""}>
                        {person.full_name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Box>
            )}
            {poorNotice(OTHER)}
            {problemOf(OTHER)}
            {editable && !poor[OTHER] && (
              <Box className="flex flex-wrap items-center gap-2">
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<NiUploadCloud size="small" />}
                  disabled={busy !== null}
                  onClick={() => pick(OTHER, otherKind, otherParty || holder?.party_id || null)}
                >
                  {busy?.key === OTHER ? t("client-documents-sending") : t("client-documents-choose")}
                </Button>
                <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={closeOther}>
                  {t("client-cancel")}
                </Button>
                {left && <Box className="sm:ml-auto">{left}</Box>}
              </Box>
            )}
          </Box>
        ) : editable ? (
          <Box
            ref={(line: HTMLElement | null) => {
              lines.current[OTHER] = line;
            }}
            tabIndex={-1}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <Box className="-ml-2">
              {again.length > 0 ? (
                <QuickActions
                  label={t("client-documents-other")}
                  text={t("client-documents-other")}
                  icon={<NiDocumentPlus size="small" />}
                  align="left"
                  actions={[
                    ...again,
                    {
                      key: OTHER,
                      label: t("client-documents-other-kind"),
                      icon: <NiPaperclip size="medium" />,
                      disabled: busy !== null,
                      onClick: openOther,
                    },
                  ]}
                />
              ) : (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  className="hover:bg-grey-25"
                  startIcon={<NiDocumentPlus size="small" />}
                  disabled={busy !== null}
                  onClick={openOther}
                >
                  {t("client-documents-other")}
                </Button>
              )}
            </Box>
            {left}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What a line of the documents is about: the kind, whose it is, and under it what is said of it. */
function DocumentWords({
  kind,
  name,
  detail,
  oneLine = false,
}: {
  kind: string;
  name: string | null;
  detail?: string | null;
  /** A file's name is cut to one line; a reason is read whole. */
  oneLine?: boolean;
}) {
  return (
    <>
      <span className="font-semibold">{kind}</span>
      {name ? <span className="text-text-secondary"> · {name}</span> : null}
      {detail ? (
        <Typography
          variant="caption"
          component="span"
          className={
            oneLine ? "text-text-secondary block truncate pt-0.5" : "text-text-secondary block pt-0.5 break-words"
          }
        >
          {detail}
        </Typography>
      ) : null}
    </>
  );
}

// ---------- Finishing ----------

/** What the account asks of the client (0090), as what the finish card says is still owed. */
const OWED_OF_ASK: Record<"tell" | "answer" | "none", "account" | "questions" | null> = {
  tell: "account",
  answer: "questions",
  none: null,
};

/** What the client still owes of their account, said before they finish and after (`product` namespace). */
const FINISH_OWED_KEY: Record<"account" | "questions", string> = {
  account: "client-finish-owed-account",
  questions: "client-finish-owed-questions",
};
const FINISHED_OWED_KEY: Record<"account" | "questions", string> = {
  account: "client-finished-owed-account",
  questions: "client-finished-owed-questions",
};

function Finish({
  token,
  finishedAt,
  expiresAt,
  owed,
  onSaved,
}: {
  token: string;
  finishedAt: string | null;
  expiresAt: string;
  /** What the action is prepared from and the client has not given yet: their account, or its missing answers. */
  owed: "account" | "questions" | null;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const day = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
      new Date(iso),
    );

  const finish = async () => {
    setBusy(true);
    setProblem(null);
    const result = await finishClientLink(token);
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code });
      return;
    }
    onSaved();
  };

  return (
    <Card component="section" aria-labelledby="client-finish">
      <CardContent className="flex flex-col gap-3">
        <Typography id="client-finish" variant="h5" component="h2" className="mb-0">
          {t("client-finish-title")}
        </Typography>
        {finishedAt && owed ? (
          // Finished, while the action still waits on them: never "the firm prepares your action".
          <StateLine tone="attention">{t(FINISHED_OWED_KEY[owed], { date: day(finishedAt) })}</StateLine>
        ) : finishedAt ? (
          <Alert severity="success" icon={<NiCheck />} className="neutral bg-background-paper/60!">
            {t("client-finished", { date: day(finishedAt) })}
          </Alert>
        ) : (
          <>
            <Typography variant="body1">{t("client-finish-body")}</Typography>
            {owed && <StateLine tone="attention">{t(FINISH_OWED_KEY[owed])}</StateLine>}
          </>
        )}
        <ProblemAlert problem={problem} />
        {!finishedAt && (
          <Box>
            <Button variant="contained" onClick={() => void finish()} disabled={busy}>
              {busy ? t("client-working") : t("client-finish-submit")}
            </Button>
          </Box>
        )}
        <Typography variant="body2" className="text-text-secondary">
          {t("client-expires", { date: day(expiresAt) })}
        </Typography>
      </CardContent>
    </Card>
  );
}
