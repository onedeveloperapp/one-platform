"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { openPassengerFile } from "@/modules/direito-do-passageiro/agency/actions";
import {
  DOCUMENT_KIND_KEY,
  type PaxDocument,
  READING_KEY,
  readingErrorKey,
} from "@/modules/direito-do-passageiro/agency/passengers";

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/** What ONE read of a document, in one sentence: what it is, whether it reads, what to do. */
function readingSentence(t: ReturnType<typeof useTranslations>, document: PaxDocument): string | null {
  if (document.reading === "failed") return t(readingErrorKey(document.readingError));
  if (document.reading !== "done" || !document.read) return null;
  const read = document.read;
  if (read.matches === false) {
    return t("pax-read-other", {
      // The kind inside a sentence, as Portuguese writes a common noun there.
      kind: t(DOCUMENT_KIND_KEY[document.kind]).toLocaleLowerCase("pt-BR"),
      identified: read.identified || t("pax-read-unknown"),
    });
  }
  if (read.legible === false) return [t("pax-read-illegible"), read.note].filter(Boolean).join(" ");
  return [t("pax-read-ok", { identified: read.identified || t(DOCUMENT_KIND_KEY[document.kind]) }), read.note]
    .filter(Boolean)
    .join(" ");
}

/**
 * One document of the passenger: what it is, who sent it and when, what ONE read of it, and a way to open it while
 * the file is the agency's. One that went to the firm with a case says so, and the agency no longer opens it: the
 * file is the firm's (0071, 0106).
 */
export default function DocumentLine({ document }: { document: PaxDocument }) {
  const t = useTranslations("product");
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentence = readingSentence(t, document);
  const tone =
    document.reading === "done"
      ? document.read?.matches === false || document.read?.legible === false
        ? "attention"
        : "positive"
      : document.reading === "failed"
        ? "attention"
        : "neutral";

  const open = async () => {
    if (!document.fileId) return;
    setOpening(true);
    setFailed(false);
    const result = await openPassengerFile(document.fileId);
    setOpening(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Box
      component="li"
      className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-start"
    >
      <Box className="flex min-w-0 flex-1 flex-col gap-1">
        <Box className="flex flex-wrap items-center gap-2">
          <Typography variant="subtitle2" component="p">
            {t(DOCUMENT_KIND_KEY[document.kind])}
          </Typography>
          <StatusChip label={t(READING_KEY[document.reading])} tone={tone} />
        </Box>
        <Typography variant="body2" className="text-text-secondary break-words">
          {[
            document.name,
            document.source === "passenger" ? t("pax-document-by-passenger") : t("pax-document-by-agency"),
            day(document.createdAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
        {sentence && <Typography variant="body2">{sentence}</Typography>}
        {document.handed && (
          <Typography variant="body2" className="text-text-secondary">
            {t("pax-document-handed")}
          </Typography>
        )}
        {failed && (
          <Typography variant="body2" role="alert">
            {t("pax-document-open-error")}
          </Typography>
        )}
      </Box>
      {document.fileId && !document.handed && (
        <Button variant="outlined" color="grey" size="small" disabled={opening} onClick={() => void open()}>
          {t("pax-document-open")}
        </Button>
      )}
    </Box>
  );
}
