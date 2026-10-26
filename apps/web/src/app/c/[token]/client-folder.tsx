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

import PersonFields from "@/components/cases/person-fields";
import SegmentFields from "@/components/cases/segment-fields";
import EmptyState from "@/components/product/empty-state";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiCheck from "@/icons/nexture/ni-check";
import NiPlane from "@/icons/nexture/ni-plane";
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
  INCIDENT_KEY,
  isIncident,
  missingItems,
  PERSON_FIELD_KEY,
} from "@/lib/cases/cases";
import type { ClientLinkView, ClientPerson, ClientTasks } from "@/lib/cases/client-link";
import {
  addClientDependent,
  discardClientUpload,
  finishClientLink,
  finishClientUpload,
  removeClientSegment,
  saveClientPerson,
  saveClientSegment,
  startClientUpload,
} from "@/lib/cases/client-link-actions";
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
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { formatDayBr, isMinorOn } from "@flyee/rules/person";

type OpenView = Extract<ClientLinkView, { state: "open" }>;
type Problem = { code: string; field?: string | null } | null;
/** A photo the client sent that is hard to read: the upload that waits, what it is of, and what is wrong with it. */
type PoorPhoto = { kind: DocumentKind; partyId: string | null; documentId: string; problems: PhotoProblem[] };
/** What a photo sent all the same may be answered while it is still there to send: it could not be sent now. */
const STILL_THERE: ReadonlySet<string> = new Set([PHOTO_POOR, "failed", "unavailable"]);

const STATUS_TONE: Record<string, StatusTone> = { received: "info", accepted: "positive", rejected: "attention" };
/** While a document sent in the last minutes waits for the firm, the folder is read again this often, for this long. */
const CHECK_POLL_MS = 10_000;
const CHECK_WATCH_MS = 5 * 60_000;

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

  const facts = [
    caseLabel(view.case.seq),
    isIncident(view.case.incident) ? t(INCIDENT_KEY[view.case.incident]) : null,
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
            {editable ? t("client-intro") : t("client-locked")}
          </Typography>
        </CardContent>
      </Card>

      {editable && (
        <Card component="section" aria-labelledby="client-missing">
          <CardContent className="flex flex-col gap-3">
            <Typography id="client-missing" variant="h5" component="h2" className="mb-0">
              {t("client-missing-title")}
            </Typography>
            {missing.length === 0 ? (
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
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      <ClientCourse lawsuits={tasks.course} />
      <ClientNotices token={token} notices={tasks.notices} editable={editable} onSaved={() => router.refresh()} />
      <ClientTerms token={token} terms={tasks.terms} onSaved={() => router.refresh()} />
      <ClientCivilCourt token={token} items={tasks.civilCourt} onSaved={() => router.refresh()} />
      <People token={token} people={view.people} today={today} editable={editable} onSaved={() => router.refresh()} />
      <Trip token={token} view={view} editable={editable} onSaved={() => router.refresh()} />
      <ClientStatements
        token={token}
        statements={tasks.statements}
        editable={editable}
        onSaved={() => router.refresh()}
      />
      <Documents
        token={token}
        view={view}
        holder={holder}
        claimants={claimants}
        editable={editable}
        onSaved={() => router.refresh()}
      />
      <ClientSignatures token={token} signatures={tasks.signatures} editable onSaved={() => router.refresh()} />
      {editable && (
        <Finish
          token={token}
          finishedAt={view.link.finished_at}
          expiresAt={view.link.expires_at}
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
  today,
  editable,
  onSaved,
}: {
  token: string;
  people: ClientPerson[];
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

  const formOf = (person: ClientPerson | null): readonly PersonField[] =>
    !person || isMinorOn(person.birth_date, today) === true ? MINOR_FORM : ADULT_FORM;

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
    const result = person
      ? await saveClientPerson(token, person.person_id, personFields(values, formOf(person), initial))
      : await addClientDependent(token, personFields(values, MINOR_FORM));
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
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
        onChange={setValues}
        errorField={problem?.field}
        errorText={problem ? t(caseErrorKey(problem.code)) : null}
        disabled={busy}
      />
      {problem && !problem.field && <ProblemAlert problem={problem} />}
      <Box className="flex flex-wrap gap-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? t("client-working") : person ? t("client-save") : t("client-add-child-submit")}
        </Button>
        <Button variant="text" color="grey" onClick={() => setOpen(null)} disabled={busy}>
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

        {editable &&
          (open === "new" ? (
            <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Typography variant="body1" className="font-semibold">
                {t("client-add-child")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("client-add-child-body")}
              </Typography>
              {form(null)}
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
          <EmptyState
            icon={<NiPlane />}
            title={t("client-trip-empty-title")}
            description={t("client-trip-empty-body")}
            action={editable ? { label: t("client-trip-add"), onClick: () => edit(null) } : undefined}
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
  useEffect(() => {
    if (back.current === null) return;
    const line = lines.current[back.current];
    back.current = null;
    const active = window.document.activeElement;
    if (active && active !== window.document.body && !card.current?.contains(active)) return;
    (line?.querySelector<HTMLElement>("button:not(:disabled)") ?? line)?.focus({ preventScroll: true });
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
      if (finished.ok) forget(key);
      else if (STILL_THERE.has(finished.code)) {
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

  return (
    <Card ref={card} component="section" aria-labelledby="client-documents">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="client-documents" variant="h5" component="h2" className="mb-0">
            {t("client-documents-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-documents-body")}
          </Typography>
        </Box>

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

        {needs.map((need) => {
          const sent = documentsFor(need, view.documents);
          const done = sent.some((document) => document.status !== "rejected");
          return (
            <Box
              key={need.key}
              ref={(line: HTMLElement | null) => {
                lines.current[need.key] = line;
              }}
              tabIndex={-1}
              className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
            >
              <Box className="flex flex-wrap items-center justify-between gap-2">
                <Box className="flex min-w-0 flex-col">
                  <Typography variant="body1" className="font-semibold">
                    {t(DOCUMENT_KIND_KEY[need.kind])}
                  </Typography>
                  {need.name && (
                    <Typography variant="body2" className="text-text-secondary break-words">
                      {need.name}
                    </Typography>
                  )}
                </Box>
                {done ? (
                  <StatusChip tone="positive" label={t("client-documents-done")} />
                ) : (
                  <StatusChip tone="attention" label={t("client-documents-needed")} />
                )}
              </Box>
              {sent.map((document) => (
                <Box key={document.id} className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    tone={STATUS_TONE[document.status] ?? "neutral"}
                    label={t(DOCUMENT_STATUS_KEY[document.status])}
                  />
                  <Typography variant="body2" className="min-w-0 break-all">
                    {document.name}
                  </Typography>
                  {document.status === "rejected" && document.rejected_reason && (
                    <Typography variant="body2" className="text-text-secondary w-full">
                      {t("client-document-rejected", { reason: refusal(document.rejected_reason) })}
                    </Typography>
                  )}
                </Box>
              ))}
              {poorNotice(need.key)}
              {problemOf(need.key)}
              {editable && !poor[need.key] && (
                <Box>
                  <Button
                    variant={done ? "outlined" : "contained"}
                    color={done ? "grey" : "primary"}
                    size="small"
                    disabled={busy !== null}
                    onClick={() => pick(need.key, need.kind, partyOf(need))}
                  >
                    {busy?.key === need.key
                      ? t("client-documents-sending")
                      : done
                        ? t("client-documents-send-more")
                        : t("client-documents-send")}
                  </Button>
                </Box>
              )}
            </Box>
          );
        })}

        {/* A photo that waits here still has its two ways on when the case no longer takes new files. */}
        {(editable || poor.other || problem?.key === "other") && (
          <Box
            ref={(line: HTMLElement | null) => {
              lines.current.other = line;
            }}
            tabIndex={-1}
            className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
          >
            <Typography variant="body1" className="font-semibold">
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
                  disabled={Boolean(poor.other)}
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
                    disabled={Boolean(poor.other)}
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
            {poorNotice("other")}
            {problemOf("other")}
            {editable && !poor.other ? (
              <Box>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => pick("other", otherKind, otherParty || holder?.party_id || null)}
                >
                  {busy?.key === "other" ? t("client-documents-sending") : t("client-documents-choose")}
                </Button>
              </Box>
            ) : null}
            {editable && (
              <Typography variant="body2" className="text-text-secondary">
                {t("client-documents-left", { count: view.link.uploads_left })}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Finishing ----------

function Finish({
  token,
  finishedAt,
  expiresAt,
  onSaved,
}: {
  token: string;
  finishedAt: string | null;
  expiresAt: string;
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
        {finishedAt ? (
          <Alert severity="success" icon={<NiCheck />} className="neutral bg-background-paper/60!">
            {t("client-finished", { date: day(finishedAt) })}
          </Alert>
        ) : (
          <Typography variant="body1">{t("client-finish-body")}</Typography>
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
