"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { Alert, Box, Button, Paper, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine, { type StateTone } from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiDocumentPlus from "@/icons/nexture/ni-document-plus";
import NiPlane from "@/icons/nexture/ni-plane";
import NiUpload from "@/icons/nexture/ni-upload-cloud";
import NiUser from "@/icons/nexture/ni-user";
import {
  type AgreementDocument,
  agreementDocumentKey,
  type AgreementPerson,
  type AgreementTrip,
} from "@/modules/direito-do-passageiro/agency/agreement";
import {
  documentsStanding,
  documentStanding,
  neededDocuments,
  type NeededKind,
} from "@/modules/direito-do-passageiro/agency/agreement-documents";
import FileButton, { type FileButtonHandle } from "@/modules/direito-do-passageiro/agency/file-button";
import {
  DOCUMENT_KIND_KEY,
  type PaxDocumentKind,
  paxErrorKey,
  SEND_DOCUMENT_KEY,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendLinkFile } from "@/modules/direito-do-passageiro/agency/send-files";

const STANDING_TONE: Record<ReturnType<typeof documentStanding>, StateTone> = {
  fine: "done",
  reading: "waiting",
  problem: "attention",
};

const AGAIN_KEY: Record<NeededKind, string> = {
  identity: "pax-link-send-identity-again",
  address_proof: "pax-link-send-address-again",
};

/**
 * The passenger's documents on the agency's link (the owner, 2026-11-03): sending is their choice, so the card
 * asks in view only for what the firm needs and has not arrived (an identity of each person, a proof of address of
 * the adult the link is for) or arrived in a way that does not serve, each on its own line with its button; what
 * arrived and serves is said as done, green, and sending another copy, or a boarding pass, is kept in "Enviar
 * outro documento", one click away. Once every document the firm needs serves, the card says so first: the
 * passenger whose agency already sent everything has nothing left to do here.
 */
export default function DocumentsSection({
  token,
  people,
  trips,
  uploadsLeft,
  onSent,
}: {
  token: string;
  people: AgreementPerson[];
  trips: AgreementTrip[];
  uploadsLeft: number;
  /** Called once a file arrived, so the page reads itself again and watches ONE read it. */
  onSent: () => Promise<void>;
}) {
  const t = useTranslations("product");
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ personId: string; ok: boolean; text: string } | null>(null);
  const standing = documentsStanding(people);
  const canSend = uploadsLeft > 0;

  const send = async (person: AgreementPerson, kind: PaxDocumentKind, tripId: string | null, file: File) => {
    setSending(`${person.id}:${kind}:${tripId ?? ""}`);
    setNotice(null);
    const result = await sendLinkFile(token, file, { travelerId: person.id, kind, tripId });
    setSending(null);
    if (!result.ok) {
      setNotice({ personId: person.id, ok: false, text: t(paxErrorKey(result.code)) });
      return;
    }
    await onSent();
    setNotice({ personId: person.id, ok: true, text: t("pax-link-document-sent") });
  };

  const chip =
    standing === "complete" ? (
      <StatusChip label={t("pax-link-documents-complete-chip")} tone="positive" />
    ) : standing === "problem" ? (
      <StatusChip label={t("pax-link-documents-check-chip")} tone="attention" />
    ) : standing === "reading" ? (
      <StatusChip label={t("pax-link-documents-reading-chip")} tone="info" />
    ) : null;

  return (
    <Paper
      component="section"
      aria-labelledby="pax-link-documents"
      elevation={0}
      className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
    >
      <CardTitle
        id="pax-link-documents"
        icon={<NiDocumentFull size="medium" />}
        tone="secondary"
        title={t("pax-link-documents-title")}
        chip={chip}
        detail={standing === "complete" ? undefined : t("pax-link-documents-help")}
      />
      {standing === "complete" && (
        <StateLine tone="done" emphasis>
          {t("pax-link-documents-complete")}
        </StateLine>
      )}
      {!canSend && <StateLine tone="info">{t("pax-error-upload-limit")}</StateLine>}
      <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
        {people.map((person) => (
          <PersonDocuments
            key={person.id}
            person={person}
            trips={trips}
            canSend={canSend}
            sending={sending}
            notice={notice?.personId === person.id ? notice : null}
            onFile={(kind, tripId, file) => void send(person, kind, tripId, file)}
          />
        ))}
      </Box>
    </Paper>
  );
}

/** One person's documents: what the firm needs, each said with how it stands, and the rest of what was sent. */
function PersonDocuments({
  person,
  trips,
  canSend,
  sending,
  notice,
  onFile,
}: {
  person: AgreementPerson;
  trips: AgreementTrip[];
  canSend: boolean;
  sending: string | null;
  notice: { ok: boolean; text: string } | null;
  onFile: (kind: PaxDocumentKind, tripId: string | null, file: File) => void;
}) {
  const t = useTranslations("product");
  // One chooser for the person: a line's button or the quick access says which document it is for, then opens it.
  const chooser = useRef<FileButtonHandle>(null);
  const target = useRef<{ kind: PaxDocumentKind; tripId: string | null } | null>(null);
  const choose = (kind: PaxDocumentKind, tripId: string | null) => {
    target.current = { kind, tripId };
    chooser.current?.open();
  };
  const busy = sending !== null;
  const sendingHere = sending?.startsWith(`${person.id}:`) ?? false;
  const needed = neededDocuments(person);
  const neededIds = new Set(needed.flatMap((item) => item.documents.map((document) => document.id)));
  const others = person.documents.filter((document) => !neededIds.has(document.id));
  const name = person.minor ? t("pax-link-person-minor", { name: person.fullName }) : person.fullName;

  // What was sent and serves, or is being read, may be sent again; a boarding pass is always the passenger's choice.
  const quick: QuickAction[] = canSend
    ? [
        ...needed
          .filter((item) => item.standing === "fine" || item.standing === "reading")
          .map((item) => ({
            key: item.kind,
            label: t(AGAIN_KEY[item.kind]),
            icon: <NiDocumentPlus size="medium" />,
            disabled: busy,
            onClick: () => choose(item.kind, null),
          })),
        ...trips.map((trip) => ({
          key: `boarding:${trip.id}`,
          label: trip.locator
            ? t("pax-link-send-boarding-of", { locator: trip.locator })
            : t("pax-document-send-boarding"),
          icon: <NiPlane size="medium" />,
          disabled: busy,
          onClick: () => choose("boarding_pass", trip.id),
        })),
      ]
    : [];

  const sendButton = (kind: PaxDocumentKind, label: string) =>
    canSend ? (
      <Button
        variant="outlined"
        color="grey"
        size="small"
        disabled={busy}
        startIcon={<NiUpload size="small" />}
        onClick={() => choose(kind, null)}
      >
        {label}
      </Button>
    ) : undefined;

  const line = (document: AgreementDocument, action?: ReactNode) => (
    <Box component="li" key={document.id}>
      <StateLine tone={STANDING_TONE[documentStanding(document)]} action={action}>
        {t("pax-link-document-line", {
          kind: t(DOCUMENT_KIND_KEY[document.kind]),
          state: t(agreementDocumentKey(document)),
        })}
      </StateLine>
    </Box>
  );

  return (
    <Box component="li" className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
      <Box className="flex flex-row items-center gap-2">
        <span aria-hidden className="text-text-secondary flex-none">
          <NiUser size="medium" />
        </span>
        <Typography variant="subtitle1" component="h3" className="mb-0 min-w-0 flex-1 break-words">
          {name}
        </Typography>
      </Box>
      <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
        {needed.map((item) =>
          item.documents.length === 0 ? (
            <Box component="li" key={item.kind}>
              <StateLine
                tone="info"
                icon={<NiDocumentPlus size="medium" />}
                action={sendButton(item.kind, t(SEND_DOCUMENT_KEY[item.kind]))}
              >
                {t("pax-link-document-not-sent", { kind: t(DOCUMENT_KIND_KEY[item.kind]) })}
              </StateLine>
            </Box>
          ) : (
            item.documents.map((document) =>
              // A document that does not serve asks for another only while nothing else of its kind serves.
              line(
                document,
                item.standing === "problem" && documentStanding(document) === "problem"
                  ? sendButton(item.kind, t("pax-link-send-again"))
                  : undefined,
              ),
            )
          ),
        )}
        {others.map((document) => line(document))}
        {/* The file on its way, said where the person sent it from, whichever control they used. */}
        {sendingHere && (
          <Box component="li">
            <StateLine tone="waiting" icon={<NiUpload size="medium" />}>
              {t("pax-link-document-sending")}
            </StateLine>
          </Box>
        )}
      </Box>
      {/* What may be sent again, after what was sent: the quiet way, under the list it adds to. */}
      {quick.length > 0 && (
        <Box className="-ml-2">
          <QuickActions
            label={t("pax-link-send-other-of", { name: person.fullName })}
            text={t("pax-link-send-other")}
            icon={<NiDocumentPlus size="small" />}
            actions={quick}
            align="left"
          />
        </Box>
      )}
      <Box role="status" aria-live="polite">
        {notice && (
          <Alert
            severity={notice.ok ? "success" : "error"}
            className={notice.ok ? "neutral bg-background-paper/60!" : undefined}
          >
            {notice.text}
          </Alert>
        )}
      </Box>
      <FileButton
        ref={chooser}
        bare
        label={name}
        onFile={(file) => {
          if (target.current) onFile(target.current.kind, target.current.tripId, file);
        }}
      />
    </Box>
  );
}
