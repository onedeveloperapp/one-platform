"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
} from "@mui/material";

import StateLine from "@/components/product/state-line";
import type { ClientResidenceItem } from "@/lib/cases/client-link";
import { answerResidence } from "@/lib/cases/client-link-actions";
import {
  isResidenceRelation,
  RELATION_KEY,
  RESIDENCE_RELATIONS,
  residenceErrorKey,
  type ResidenceRelation,
} from "@/lib/cases/residence";

/**
 * A bill the client sent in somebody else's name, which the firm accepts with a declaration of residence (migration
 * 0123): the page says whose bill it is (as read, which the client may correct) and asks who that person is to them;
 * then the declaration comes to sign, below. Once it was sent to sign, the answer stays as it was.
 */
export default function ClientResidence({
  token,
  items,
  editable,
  onSaved,
}: {
  token: string;
  items: ClientResidenceItem[];
  editable: boolean;
  onSaved: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <ResidenceItem key={item.id} token={token} item={item} editable={editable} onSaved={onSaved} />
      ))}
    </>
  );
}

function ResidenceItem({
  token,
  item,
  editable,
  onSaved,
}: {
  token: string;
  item: ClientResidenceItem;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const answered = isResidenceRelation(item.relation) ? item.relation : null;
  const [editing, setEditing] = useState(answered === null);
  const [relation, setRelation] = useState<ResidenceRelation | "">(answered ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [holder, setHolder] = useState(item.holder);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const said = answered
    ? answered === "outro" && item.note
      ? item.note
      : t(RELATION_KEY[answered]).toLowerCase()
    : null;

  const send = async () => {
    if (!relation) return setProblem("relation");
    setBusy(true);
    setProblem(null);
    try {
      const result = await answerResidence(token, item.id, {
        relation,
        note: relation === "outro" ? note : null,
        holder: holder.trim() === item.holder ? "" : holder,
      });
      if (result.ok) {
        setEditing(false);
        onSaved();
      } else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientSection
      id={`residence-${item.id}`}
      title={t("client-residence-title")}
      lead={t("client-residence-body", { holder: item.holder })}
    >
      {item.issued ? (
        <StateLine tone="done">{t("client-residence-issued")}</StateLine>
      ) : !editing && said ? (
        <Box className="flex flex-col gap-2">
          <StateLine tone="done">{t("client-residence-answered", { holder: item.holder, relation: said })}</StateLine>
          {editable ? (
            <Box>
              <Button variant="text" size="small" onClick={() => setEditing(true)}>
                {t("client-residence-change")}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : editable ? (
        <Box
          component="form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {problem ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {t(residenceErrorKey(problem))}
            </Alert>
          ) : null}
          <FormControl component="fieldset">
            <FormLabel component="legend" id={`residence-relation-${item.id}`} className="mb-1">
              {t("client-residence-question", { holder: item.holder })}
            </FormLabel>
            <RadioGroup
              aria-labelledby={`residence-relation-${item.id}`}
              name={`relation-${item.id}`}
              value={relation}
              onChange={(event) => setRelation(event.target.value as ResidenceRelation)}
            >
              {RESIDENCE_RELATIONS.map((option) => (
                <FormControlLabel key={option} value={option} control={<Radio />} label={t(RELATION_KEY[option])} />
              ))}
            </RadioGroup>
          </FormControl>
          {relation === "outro" ? (
            <TextField
              label={t("residence-field-note")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              helperText={t("residence-field-note-help")}
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
          ) : null}
          <TextField
            label={t("client-residence-holder")}
            value={holder}
            onChange={(event) => setHolder(event.target.value)}
            helperText={t("client-residence-holder-help")}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <Box>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("residence-saving") : t("client-residence-send")}
            </Button>
          </Box>
        </Box>
      ) : null}
    </ClientSection>
  );
}
