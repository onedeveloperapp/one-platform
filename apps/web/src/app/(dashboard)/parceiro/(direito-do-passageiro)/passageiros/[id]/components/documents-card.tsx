"use client";

import DocumentLine from "./document-line";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiDocumentPlus from "@/icons/nexture/ni-document-plus";
import NiUpload from "@/icons/nexture/ni-upload-cloud";
import { kindStanding, type StandingInput } from "@/modules/direito-do-passageiro/agency/agreement-documents";
import FileButton, { type FileButtonHandle } from "@/modules/direito-do-passageiro/agency/file-button";
import {
  DOCUMENT_KIND_KEY,
  type PaxDetail,
  type PaxDocument,
  type PaxDocumentKind,
  paxErrorKey,
  PERSON_DOCUMENT_KINDS,
  SEND_DOCUMENT_KEY,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendAgencyFile } from "@/modules/direito-do-passageiro/agency/send-files";

/** What a document's standing is read from: its reading and what the reading said of it. */
const standingInput = (document: PaxDocument): StandingInput => ({
  reading: document.reading,
  legible: document.read?.legible ?? null,
  matches: document.read?.matches ?? null,
});

const AGAIN_KEY: Record<"identity" | "address_proof", string> = {
  identity: "pax-link-send-identity-again",
  address_proof: "pax-link-send-address-again",
};

/**
 * The passenger's own documents: an identity, and for an adult a proof of address. ONE reads each one and fills
 * what the record lacks, never what somebody wrote. The tickets and boarding passes are of a trip, on its card.
 * The card asks in view only for what has not arrived, or arrived in a way that does not serve (the owner,
 * 2026-11-03); sending another copy of what arrived and serves is one click away, in "Enviar outro documento".
 * A passenger whose trip became a case is still the agency's for their next trips (0106): what went to the firm
 * with the case says so on its line, and the agency sends what the next trips need as before.
 */
export default function DocumentsCard({ detail, onChanged }: { detail: PaxDetail; onChanged: () => void }) {
  const t = useTranslations("product");
  const traveler = detail.traveler;
  // A ticket or boarding pass waiting for its trip has no trip yet, and is still no document of the person.
  const documents = detail.documents.filter((document) => PERSON_DOCUMENT_KINDS.includes(document.kind));
  const kinds = (traveler.minor ? ["identity"] : PERSON_DOCUMENT_KINDS) as readonly ("identity" | "address_proof")[];
  const [sending, setSending] = useState<PaxDocumentKind | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const chooser = useRef<FileButtonHandle>(null);
  const target = useRef<PaxDocumentKind>("identity");

  const choose = (kind: PaxDocumentKind) => {
    target.current = kind;
    chooser.current?.open();
  };

  const send = async (kind: PaxDocumentKind, file: File) => {
    setSending(kind);
    setMessage(null);
    const result = await sendAgencyFile(file, { travelerId: traveler.id, kind, tripId: null });
    setSending(null);
    setMessage(
      result.ok ? { ok: true, text: t("pax-document-sent") } : { ok: false, text: t(paxErrorKey(result.code)) },
    );
    if (result.ok) onChanged();
  };

  const byKind = kinds.map((kind) => {
    const sent = documents.filter((document) => document.kind === kind);
    return { kind, sent, standing: kindStanding(sent.map(standingInput)) };
  });
  const complete = byKind.every((item) => item.standing === "fine");
  const chip = complete ? (
    <StatusChip label={t("pax-link-documents-complete-chip")} tone="positive" />
  ) : byKind.some((item) => item.standing === "problem") ? (
    <StatusChip label={t("pax-link-documents-check-chip")} tone="attention" />
  ) : byKind.some((item) => item.standing === "reading") ? (
    <StatusChip label={t("pax-link-documents-reading-chip")} tone="info" />
  ) : null;

  // Another copy of a kind that arrived, one click away; what is owed has its own button, in view.
  const quick: QuickAction[] = byKind
    .filter((item) => item.standing === "fine" || item.standing === "reading")
    .map((item) => ({
      key: item.kind,
      label: t(AGAIN_KEY[item.kind]),
      icon: <NiDocumentPlus size="medium" />,
      disabled: sending !== null,
      onClick: () => choose(item.kind),
    }));

  const sendButton = (kind: PaxDocumentKind, label: string) => (
    <Button
      variant="outlined"
      color="grey"
      size="small"
      disabled={sending !== null}
      startIcon={<NiUpload size="small" />}
      onClick={() => choose(kind)}
    >
      {sending === kind ? t("pax-document-sending") : label}
    </Button>
  );

  return (
    <Card component="section" aria-labelledby="pax-documents-title">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="pax-documents-title"
          icon={<NiDocumentFull size="medium" />}
          tone="secondary"
          title={t("pax-documents-title")}
          description={t("pax-documents-help")}
          chip={chip}
          actions={
            quick.length > 0 ? (
              <QuickActions
                label={t("pax-link-send-other-of", { name: traveler.fullName })}
                icon={<NiDocumentPlus size="medium" />}
                actions={quick}
              />
            ) : undefined
          }
        />
        {complete && (
          <StateLine tone="done" emphasis>
            {t("pax-documents-complete")}
          </StateLine>
        )}
        {documents.length === 0 ? (
          <EmptyState
            titleAs="h3"
            icon={<NiDocumentPlus size="large" />}
            title={t("pax-documents-empty-title")}
            description={t("pax-documents-empty-body")}
            action={{
              label: sending === "identity" ? t("pax-document-sending") : t("pax-document-send-identity"),
              onClick: () => choose("identity"),
            }}
          />
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {documents.map((document) => (
              <DocumentLine key={document.id} document={document} />
            ))}
          </Box>
        )}
        {/* What is owed, each on its own line with its button: not arrived (the identity of an empty card is its
            empty state's action), or arrived in a way that does not serve. */}
        {byKind
          .filter((item) => item.standing === "problem" || (item.standing === "missing" && documents.length > 0))
          .concat(
            documents.length === 0
              ? byKind.filter((item) => item.kind !== "identity" && item.standing === "missing")
              : [],
          )
          .map((item) => (
            <StateLine
              key={item.kind}
              tone={item.standing === "problem" ? "attention" : "info"}
              icon={item.standing === "problem" ? undefined : <NiDocumentPlus size="medium" />}
              action={sendButton(
                item.kind,
                item.standing === "problem" ? t(AGAIN_KEY[item.kind]) : t(SEND_DOCUMENT_KEY[item.kind]),
              )}
            >
              {item.standing === "problem"
                ? t("pax-documents-not-serving", { kind: t(DOCUMENT_KIND_KEY[item.kind]) })
                : t("pax-link-document-not-sent", { kind: t(DOCUMENT_KIND_KEY[item.kind]) })}
            </StateLine>
          ))}
        {message && (
          <Alert
            severity={message.ok ? "success" : "error"}
            className={message.ok ? "neutral bg-background-paper/60!" : undefined}
          >
            {message.text}
          </Alert>
        )}
        <FileButton
          ref={chooser}
          bare
          label={t("pax-documents-title")}
          onFile={(file) => void send(target.current, file)}
        />
      </CardContent>
    </Card>
  );
}
