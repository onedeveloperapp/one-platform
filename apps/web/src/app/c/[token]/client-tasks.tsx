"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import ProductMarkdown from "@/components/product/product-markdown";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { caseErrorKey, DOCUMENT_KIND_KEY, firstNameOf, isDocumentKind } from "@/lib/cases/cases";
import type { ClientSignature, ClientTerm } from "@/lib/cases/client-link";
import {
  acceptClientTerms,
  downloadSignatureOriginal,
  finishClientUpload,
  startClientSignedUpload,
} from "@/lib/cases/client-link-actions";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";

/** The service of the federal government where a person signs a PDF with their gov.br account. */
const GOVBR_SIGNER = "https://assinador.iti.br/";

const when = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
    new Date(iso),
  );

/**
 * The texts the client is asked to accept (one per purpose, as the platform
 * publishes them), each read in full and accepted on its own. What was
 * accepted stays listed with the day.
 */
export function ClientTerms({ token, terms, onSaved }: { token: string; terms: ClientTerm[]; onSaved: () => void }) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (terms.length === 0) return null;

  const accept = async (term: ClientTerm) => {
    setBusy(term.id);
    setProblem(null);
    try {
      const result = await acceptClientTerms(token, [term.id]);
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ClientSection id="client-terms" title={t("client-terms-title")} hint={t("client-terms-body")}>
      {terms.map((term) => (
        <Box key={term.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body1" className="font-semibold">
              {term.title}
            </Typography>
            {term.accepted_at && (
              <StatusChip tone="positive" label={t("client-terms-accepted", { date: when(term.accepted_at) })} />
            )}
          </Box>
          {!term.accepted_at && (
            <>
              <ProductMarkdown>{term.body_md}</ProductMarkdown>
              <Box>
                <Button variant="contained" size="small" disabled={busy !== null} onClick={() => void accept(term)}>
                  {busy === term.id ? t("client-working") : t("client-terms-accept")}
                </Button>
              </Box>
            </>
          )}
        </Box>
      ))}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(caseErrorKey(problem))}
        </Alert>
      )}
    </ClientSection>
  );
}

/**
 * What the client signs. By ZapSign, their own address to sign; by gov.br,
 * the three steps (download, sign at gov.br, send it back); by e-Notariado,
 * the link of the act. A document waits for the firm once the client did
 * their part.
 */
export function ClientSignatures({
  token,
  signatures,
  editable,
  titled = true,
  onSaved,
}: {
  token: string;
  signatures: ClientSignature[];
  editable: boolean;
  /** Its own title, which the page of the papers alone (`/c/[token]/assinar`) already says. */
  titled?: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  if (signatures.length === 0) return null;

  const download = async (signature: ClientSignature) => {
    setBusy(`download-${signature.id}`);
    setProblem(null);
    try {
      const link = await downloadSignatureOriginal(token, signature.id);
      if (link.ok) window.location.assign(link.url);
      else setProblem(link.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  const send = async (file: File) => {
    const envelopeId = target.current;
    if (!envelopeId) return;
    setBusy(`send-${envelopeId}`);
    setProblem(null);
    try {
      const mime = mimeOf(file);
      const started = await startClientSignedUpload(token, { envelopeId, name: file.name, mime, bytes: file.size });
      if (!started.ok) {
        setProblem(started.code);
        return;
      }
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) {
        setProblem("not_uploaded");
        return;
      }
      const finished = await finishClientUpload(token, started.documentId);
      if (!finished.ok) setProblem(finished.code);
    } catch {
      setProblem("not_uploaded");
    } finally {
      setBusy(null);
      onSaved();
    }
  };

  const label = (signature: ClientSignature) =>
    isDocumentKind(signature.kind) ? t(DOCUMENT_KIND_KEY[signature.kind]) : signature.name;

  const body = (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept="application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void send(file);
        }}
      />

      {signatures.map((signature) => {
        const done = signature.status === "signed" || Boolean(signature.signed_at);
        return (
          <Box key={signature.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-center justify-between gap-2">
              <Box className="flex min-w-0 flex-col">
                <Typography variant="body1" className="font-semibold">
                  {label(signature)}
                </Typography>
                <Typography variant="body2" className="text-text-secondary break-all">
                  {signature.name}
                </Typography>
              </Box>
              <StatusChip
                tone={
                  signature.status === "signed"
                    ? "positive"
                    : done || signature.status === "received"
                      ? "info"
                      : "attention"
                }
                label={
                  signature.status === "signed"
                    ? t("client-signature-signed")
                    : signature.status === "received" || done
                      ? t("client-signature-waiting-firm")
                      : t("client-signature-to-sign")
                }
              />
            </Box>

            {editable &&
              signature.status === "pending" &&
              !done &&
              signature.method === "zapsign" &&
              signature.sign_url && (
                <Box>
                  <Button variant="contained" href={signature.sign_url} target="_blank" rel="noopener noreferrer">
                    {t("client-signature-sign")}
                  </Button>
                </Box>
              )}

            {/* A minor of 16 or 17 this person assists signs the same document beside them (0224). */}
            {signature.status === "pending" && signature.method === "zapsign"
              ? (signature.assisted ?? []).map((part) =>
                  part.signed_at ? (
                    <StateLine key={part.name} tone="done">
                      {t("client-signature-assisted-signed", { name: part.name })}
                    </StateLine>
                  ) : (
                    <StateLine
                      key={part.name}
                      tone="attention"
                      action={
                        editable && part.sign_url ? (
                          <Button
                            variant="outlined"
                            size="small"
                            href={part.sign_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("client-signature-assisted-sign", { name: firstNameOf(part.name) })}
                          </Button>
                        ) : undefined
                      }
                    >
                      {t("client-signature-assisted-waiting", { name: part.name })}
                    </StateLine>
                  ),
                )
              : null}

            {editable && signature.status === "pending" && signature.method === "govbr" && (
              <Box component="ol" className="m-0 flex list-decimal flex-col gap-3 pl-5">
                <Typography component="li" variant="body1">
                  {t("client-signature-govbr-download")}{" "}
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    disabled={busy !== null}
                    onClick={() => void download(signature)}
                  >
                    {busy === `download-${signature.id}` ? t("client-working") : t("client-signature-download")}
                  </Button>
                </Typography>
                <Typography component="li" variant="body1">
                  {t("client-signature-govbr-sign")}{" "}
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    href={GOVBR_SIGNER}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("client-signature-govbr-open")}
                  </Button>
                </Typography>
                {(signature.assisted ?? []).length > 0 ? (
                  <Typography component="li" variant="body1">
                    {t("client-signature-govbr-assisted", {
                      names: (signature.assisted ?? []).map((part) => part.name).join(" e "),
                    })}
                  </Typography>
                ) : null}
                <Typography component="li" variant="body1">
                  {t("client-signature-govbr-send")}{" "}
                  <Button
                    variant="contained"
                    size="small"
                    disabled={busy !== null}
                    onClick={() => {
                      target.current = signature.id;
                      setProblem(null);
                      input.current?.click();
                    }}
                  >
                    {busy === `send-${signature.id}` ? t("client-documents-sending") : t("client-signature-send")}
                  </Button>
                </Typography>
              </Box>
            )}

            {editable &&
              signature.status === "pending" &&
              signature.method === "enotariado" &&
              signature.enotariado_url && (
                <Box className="flex flex-col gap-2">
                  <Typography variant="body2">{t("client-signature-enotariado-body")}</Typography>
                  <Box>
                    <Button
                      variant="contained"
                      href={signature.enotariado_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("client-signature-enotariado-open")}
                    </Button>
                  </Box>
                </Box>
              )}
          </Box>
        );
      })}

      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(caseErrorKey(problem))}
        </Alert>
      )}
    </>
  );
  // The page of the papers alone (`/c/[token]/assinar`) says its own title.
  if (!titled) {
    return (
      <Card component="section" id="assinar" aria-label={t("client-signatures-title")}>
        <CardContent className="flex flex-col gap-4">{body}</CardContent>
      </Card>
    );
  }
  return (
    // "#assinar" is where a message to the client leads.
    <Box id="assinar" className="scroll-mt-4">
      <ClientSection id="client-signatures" title={t("client-signatures-title")} hint={t("client-signatures-body")}>
        {body}
      </ClientSection>
    </Box>
  );
}
