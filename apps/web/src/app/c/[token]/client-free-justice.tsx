"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import { answerFreeJustice, finishClientUpload, startClientUpload } from "@/lib/cases/client-link-actions";
import { type ClientFreeJustice, freeJusticeErrorKey } from "@/lib/cases/free-justice";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";

/**
 * Free justice, asked on the client's link for each claim of theirs that goes to the civil court (migration 0125):
 * their own and their children's; and for their recurso of the small-claims court (0218), whatever the case's stage.
 * The client says whether they ask for it; who asks signs a declaration that ONE sends below, and may send a proof of
 * income, optional, while the case is open to them. The answer may change until the lawsuit or the recurso is filed.
 */
export default function ClientFreeJustice({
  token,
  view,
  editable,
  onSaved,
}: {
  token: string;
  /** None when it could not be read, or nothing to ask: the section is then left out. */
  view: ClientFreeJustice | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  if (!view || view.items.length === 0) return null;
  const asking = view.items.some((item) => item.asks === true);
  const answered = view.items.every((item) => item.asks !== null);
  // The recurso of the small-claims court is asked once the case is with the court: its answer is open all the same.
  const appeal = view.items.some((item) => item.appeal);

  const answer = async (partyId: string, asks: boolean) => {
    setBusy(partyId);
    setProblem(null);
    try {
      const result = await answerFreeJustice(token, partyId, asks);
      if (!result.ok) setProblem(result.code);
      onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  const send = async (file: File) => {
    if (!view.ownParty) return;
    setBusy("income");
    setProblem(null);
    try {
      const mime = mimeOf(file);
      const started = await startClientUpload(token, {
        kind: "income_proof",
        partyId: view.ownParty,
        name: file.name,
        mime,
        bytes: file.size,
      });
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
        setProblem("failed");
        return;
      }
      // A photo hard to read is sent all the same once the record says so: the proof is optional, and the firm reads it.
      let finished = await finishClientUpload(token, started.documentId);
      if (!finished.ok && finished.code === "photo_poor") {
        finished = await finishClientUpload(token, started.documentId, { insist: true });
      }
      if (!finished.ok) setProblem(finished.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
      onSaved();
    }
  };

  return (
    <Card component="section" aria-labelledby="client-free-justice">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="client-free-justice" variant="h5" component="h2" className="mb-0">
            {t("client-free-justice-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t(appeal ? "client-free-justice-body-appeal" : "client-free-justice-body")}
          </Typography>
        </Box>
        {view.items.map((item) => (
          <Box
            key={item.partyId}
            className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography variant="body1" className="font-semibold">
                {item.minor ? t("client-free-justice-minor", { name: item.name }) : t("client-free-justice-own")}
              </Typography>
              {item.asks === true ? (
                <StateLine tone="done">{t("client-free-justice-asks")}</StateLine>
              ) : item.asks === false ? (
                <StateLine tone="info">{t("client-free-justice-not-asks")}</StateLine>
              ) : (
                <StateLine tone="attention">{t("client-free-justice-waiting")}</StateLine>
              )}
            </Box>
            {editable || item.appeal ? (
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant={item.asks === true ? "contained" : "outlined"}
                  size="small"
                  disabled={busy !== null || item.asks === true}
                  onClick={() => void answer(item.partyId, true)}
                >
                  {busy === item.partyId ? t("client-working") : t("client-free-justice-yes")}
                </Button>
                <Button
                  variant={item.asks === false ? "contained" : "outlined"}
                  color="grey"
                  size="small"
                  disabled={busy !== null || item.asks === false}
                  onClick={() => void answer(item.partyId, false)}
                >
                  {t("client-free-justice-no")}
                </Button>
              </Box>
            ) : null}
          </Box>
        ))}
        {asking && answered ? (
          <StateLine tone={view.issued ? "done" : "waiting"}>
            {view.issued ? t("client-free-justice-issued") : t("client-free-justice-issuing")}
          </StateLine>
        ) : null}
        {asking && view.ownParty ? (
          view.income ? (
            <StateLine tone="done">{t("client-free-justice-income-sent")}</StateLine>
          ) : editable ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="text-text-secondary">
                {t("client-free-justice-income-help")}
              </Typography>
              <Box>
                <Button variant="outlined" size="small" disabled={busy !== null} onClick={() => input.current?.click()}>
                  {busy === "income" ? t("client-working") : t("client-free-justice-income")}
                </Button>
              </Box>
              <input
                ref={input}
                type="file"
                accept="application/pdf,image/*"
                hidden
                aria-label={t("client-free-justice-income")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void send(file);
                }}
              />
            </Box>
          ) : null
        ) : null}
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(freeJusticeErrorKey(problem))}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
