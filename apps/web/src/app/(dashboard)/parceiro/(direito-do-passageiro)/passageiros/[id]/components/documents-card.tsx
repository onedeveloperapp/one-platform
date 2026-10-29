"use client";

import DocumentLine from "./document-line";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiDocumentPlus from "@/icons/nexture/ni-document-plus";
import FileButton, { type FileButtonHandle } from "@/modules/direito-do-passageiro/agency/file-button";
import {
  type PaxDetail,
  type PaxDocumentKind,
  paxErrorKey,
  PERSON_DOCUMENT_KINDS,
  SEND_DOCUMENT_KEY,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendAgencyFile } from "@/modules/direito-do-passageiro/agency/send-files";

/**
 * The passenger's own documents: an identity, and for an adult a proof of address. ONE reads each one and fills
 * what the record lacks, never what somebody wrote. The tickets and boarding passes are of a trip, on its card.
 */
export default function DocumentsCard({ detail, onChanged }: { detail: PaxDetail; onChanged: () => void }) {
  const t = useTranslations("product");
  const traveler = detail.traveler;
  const documents = detail.documents.filter((document) => document.tripId === null);
  const kinds: readonly PaxDocumentKind[] = traveler.minor ? ["identity"] : PERSON_DOCUMENT_KINDS;
  const [sending, setSending] = useState<PaxDocumentKind | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const identityButton = useRef<FileButtonHandle>(null);
  const locked = traveler.handedOver;

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

  // With nothing sent yet, the empty state offers the identity, and the button below it is left out.
  const empty = documents.length === 0;
  const buttons = !locked && (
    <Box className="flex flex-wrap gap-2">
      {kinds.map((kind) => (
        <FileButton
          key={kind}
          ref={kind === "identity" ? identityButton : undefined}
          bare={empty && kind === "identity"}
          variant="outlined"
          color="grey"
          size="small"
          disabled={sending !== null}
          label={sending === kind ? t("pax-document-sending") : t(SEND_DOCUMENT_KEY[kind])}
          onFile={(file) => void send(kind, file)}
        />
      ))}
    </Box>
  );

  return (
    <Card component="section" aria-labelledby="pax-documents-title">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="pax-documents-title" variant="h5" component="h2" className="mb-0">
            {t("pax-documents-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("pax-documents-help")}
          </Typography>
        </Box>
        {empty ? (
          <EmptyState
            titleAs="h3"
            icon={<NiDocumentPlus size="large" />}
            title={t("pax-documents-empty-title")}
            description={t("pax-documents-empty-body")}
            action={
              locked
                ? undefined
                : {
                    label: sending === "identity" ? t("pax-document-sending") : t("pax-document-send-identity"),
                    onClick: () => identityButton.current?.open(),
                  }
            }
          />
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {documents.map((document) => (
              <DocumentLine key={document.id} document={document} canOpen={!locked} />
            ))}
          </Box>
        )}
        {message && (
          <Alert
            severity={message.ok ? "success" : "error"}
            className={message.ok ? "neutral bg-background-paper/60!" : undefined}
          >
            {message.text}
          </Alert>
        )}
        {buttons}
      </CardContent>
    </Card>
  );
}
