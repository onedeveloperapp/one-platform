"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import { answerClientFacts } from "@/lib/cases/client-link-actions";
import { type ClientPieceFacts, pieceFactsErrorKey } from "@/lib/cases/piece-facts";

/**
 * The facts of the client's action, in plain words, for them to confirm before it goes to court (migration 0182): the
 * client confirms them, or says what is wrong in their own words, and the firm corrects the action and shows it again.
 * Shown whatever the stage of the case: the facts are asked once the action is written.
 */
export default function ClientPieceFacts({
  token,
  items,
  onSaved,
}: {
  token: string;
  items: ClientPieceFacts[];
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  if (items.length === 0) return null;
  return (
    <ClientSection id="piece-facts-title" title={t("client-piece-facts-title")} hint={t("client-piece-facts-body")}>
      {items.map((item) => (
        <FactsItem key={item.id} token={token} item={item} several={items.length > 1} onSaved={onSaved} />
      ))}
    </ClientSection>
  );
}

function FactsItem({
  token,
  item,
  several,
  onSaved,
}: {
  token: string;
  item: ClientPieceFacts;
  several: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kindKey = item.kind === "comum" ? "client-piece-facts-civil" : "client-piece-facts-juizado";

  const send = async (confirmed: boolean) => {
    if (!confirmed && note.trim().length < 10) return setProblem("note_required");
    setBusy(true);
    setProblem(null);
    try {
      const result = await answerClientFacts(token, item.id, confirmed, note);
      if (result.ok) {
        setCorrecting(false);
        onSaved();
      } else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="flex flex-col gap-3">
      {several ? (
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t(kindKey)}
        </Typography>
      ) : null}
      <Box className="border-grey-100 bg-grey-25 rounded-xl border p-4">
        <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
          {item.facts}
        </Typography>
      </Box>
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {t(pieceFactsErrorKey(problem))}
        </Alert>
      ) : null}
      {item.status === "confirmed" ? (
        <StateLine tone="done">{t("client-piece-facts-confirmed")}</StateLine>
      ) : item.status === "corrected" ? (
        <StateLine tone="waiting">{t("client-piece-facts-corrected")}</StateLine>
      ) : correcting ? (
        <Box
          component="form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(false);
          }}
        >
          <TextField
            multiline
            minRows={3}
            label={t("client-piece-facts-note")}
            helperText={t("client-piece-facts-note-help")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <Box className="flex flex-wrap gap-2">
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("client-piece-facts-sending") : t("client-piece-facts-send")}
            </Button>
            <Button variant="text" color="grey" disabled={busy} onClick={() => setCorrecting(false)}>
              {t("client-piece-facts-back")}
            </Button>
          </Box>
        </Box>
      ) : (
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" disabled={busy} onClick={() => void send(true)}>
            {busy ? t("client-piece-facts-sending") : t("client-piece-facts-confirm")}
          </Button>
          <Button variant="outlined" color="grey" disabled={busy} onClick={() => setCorrecting(true)}>
            {t("client-piece-facts-wrong")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
