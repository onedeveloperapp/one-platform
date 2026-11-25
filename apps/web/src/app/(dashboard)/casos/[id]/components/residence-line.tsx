"use client";

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

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiHome from "@/icons/nexture/ni-home";
import {
  holderCorrected,
  RELATION_KEY,
  RESIDENCE_RELATIONS,
  residenceErrorKey,
  type ResidenceRelation,
  type ResidenceView,
} from "@/lib/cases/residence";
import { recordResidenceRelation, waiveResidenceDeclaration } from "@/lib/cases/residence-actions";

/**
 * What a bill in somebody else's name owes, under the bill on the case's card of documents (migration 0123): whose
 * bill it is (ONE read the name and may have erred), who the holder is to the client and who said it, and where the
 * client's declaration of residence stands: the client's word, an address of another city a person looks at, ONE
 * issuing it, the client signing it, signed. The firm records who the holder is as the client told it, and a partner
 * or a lawyer goes on without the declaration, after reading what that may cost. In the declaration's place, a
 * document of the client's link to the holder (0294): where the latest one stands, the firm sending one for the
 * client, and the declaration settled by it.
 */
export default function ResidenceLine({
  caseId,
  view,
  recordAddress = null,
  writable,
  mayWaive,
  onSendLink,
  onChanged,
}: {
  caseId: string;
  view: ResidenceView;
  /** The address the person's record has, said beside the bill's city when the two differ. */
  recordAddress?: string | null;
  writable: boolean;
  /** A partner or a lawyer of the firm: who may go on without the declaration. */
  mayWaive: boolean;
  /** The firm sends the document of the link for the client (0294). */
  onSendLink?: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [recording, setRecording] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [factor, setFactor] = useState(false);

  const relation = view.relation
    ? view.relation === "outro" && view.note
      ? view.note
      : t(RELATION_KEY[view.relation]).toLowerCase()
    : null;
  const who = relation ? t("residence-holder-relation", { holder: view.holder, relation }) : view.holder;
  const open = view.standing !== "signed" && view.standing !== "waived" && view.standing !== "linked";
  const actions = [
    ...(writable && (view.standing === "asking" || view.standing === "conflict" || view.standing === "issuing")
      ? [
          {
            key: "relation",
            label: view.relation ? t("residence-change-relation") : t("residence-record-relation"),
            onClick: () => setRecording(true),
          },
        ]
      : []),
    ...(writable && mayWaive && open
      ? [{ key: "waive", label: t("residence-waive"), onClick: () => setWaiving(true) }]
      : []),
  ];

  const line = (() => {
    switch (view.standing) {
      case "asking":
        return <StateLine tone="waiting">{t("residence-asking", { holder: view.holder })}</StateLine>;
      case "conflict":
        return (
          // Both places in front of the person, and the way to where the address is corrected (`WAIT_PLACE`:
          // the people's card): the record's address decides the forum.
          <StateLine
            tone="attention"
            action={
              writable ? (
                <Button variant="outlined" color="grey" size="small" href="#case-people">
                  {t("residence-conflict-fix")}
                </Button>
              ) : undefined
            }
          >
            {t("residence-conflict-both", {
              who,
              city: view.billCity ?? t("residence-city-unknown"),
              record: recordAddress ?? t("residence-record-none"),
            })}
          </StateLine>
        );
      case "issuing":
        return <StateLine tone="waiting">{t("residence-issuing", { who })}</StateLine>;
      case "signing":
        return <StateLine tone="waiting">{t("residence-signing", { who })}</StateLine>;
      case "signed":
        return <StateLine tone="done">{t("residence-signed", { who })}</StateLine>;
      case "waived":
        return <StateLine tone="info">{t("residence-waived", { reason: view.endedReason ?? "" })}</StateLine>;
      case "linked":
        return <StateLine tone="done">{t("residence-linked", { who })}</StateLine>;
    }
  })();

  // The document of the link, in the declaration's place (0294), while the declaration is still owed.
  const linkLine =
    view.standing !== "asking" && view.standing !== "issuing" && view.standing !== "signing" ? null : view.link
        ?.status === "received" ? (
      <StateLine tone="waiting">{t("residence-link-checking")}</StateLine>
    ) : (
      <StateLine
        tone={view.link?.status === "rejected" ? "attention" : "info"}
        action={
          writable && onSendLink ? (
            <Button variant="outlined" color="grey" size="small" onClick={onSendLink}>
              {t("residence-link-send")}
            </Button>
          ) : undefined
        }
      >
        {view.link?.status === "rejected"
          ? t("residence-link-refused", { reason: view.link.reason ?? "" })
          : t("residence-link-instead")}
      </StateLine>
    );

  return (
    <Box className="flex flex-col gap-2">
      <Box className="flex items-start justify-between gap-2">
        <Box className="min-w-0 flex-1">{line}</Box>
        {actions.length > 0 ? <QuickActions label={t("residence-actions")} actions={actions} /> : null}
      </Box>
      {linkLine}
      {holderCorrected(view) ? (
        <StateLine tone="info">{t("residence-holder-corrected", { read: view.holderRead })}</StateLine>
      ) : view.standing === "asking" || view.standing === "issuing" ? (
        <StateLine tone="info">{t("residence-name-read")}</StateLine>
      ) : null}
      {factor ? (
        <SecondFactorPrompt
          state="challenge"
          reason={t("residence-factor-reason")}
          onConfirmed={() => {
            setFactor(false);
            setWaiving(true);
          }}
        />
      ) : null}

      {recording ? (
        <RelationPanel
          caseId={caseId}
          view={view}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            onChanged();
          }}
        />
      ) : null}
      {waiving ? (
        <ConfirmActionDialog
          title={t("residence-waive-title")}
          intro={t("residence-waive-intro", { holder: view.holder })}
          consequences={[t("residence-waive-proof"), t("residence-waive-territory"), t("residence-waive-envelope")]}
          reasonLabel={t("residence-waive-reason")}
          reasonHelp={t("residence-waive-reason-help")}
          reasonMinLength={8}
          requireReason
          confirmLabel={t("residence-waive-confirm")}
          cancelLabel={t("residence-cancel")}
          tone="warning"
          onClose={() => setWaiving(false)}
          onConfirm={async (reason) => {
            const result = await waiveResidenceDeclaration(caseId, view.id, reason);
            if (result.ok) {
              setWaiving(false);
              onChanged();
              return null;
            }
            if (result.code === "second_factor") {
              setWaiving(false);
              setFactor(true);
              return null;
            }
            return t(residenceErrorKey(result.code));
          }}
        />
      ) : null}
    </Box>
  );
}

/** The firm records who the holder is to the client, as the client told it, and corrects the holder's name. */
function RelationPanel({
  caseId,
  view,
  onClose,
  onSaved,
}: {
  caseId: string;
  view: ResidenceView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [holder, setHolder] = useState(view.holder);
  const [relation, setRelation] = useState<ResidenceRelation | "">(view.relation ?? "");
  const [note, setNote] = useState(view.note ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    if (!relation) return setProblem("relation");
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordResidenceRelation(caseId, view.id, {
        relation,
        note: relation === "outro" ? note : null,
        holder: holder.trim() === view.holder ? "" : holder,
      });
      if (result.ok) onSaved();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("residence-cancel")}
      icon={<NiHome size="medium" />}
      tone="primary"
      busy={busy}
      title={t("residence-panel-title")}
      description={t("residence-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("residence-saving") : t("residence-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("residence-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(residenceErrorKey(problem))}
          </Alert>
        ) : null}
        <TextField
          label={t("residence-field-holder")}
          value={holder}
          onChange={(event) => setHolder(event.target.value)}
          helperText={t("residence-field-holder-help", { read: view.holderRead })}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />
        <FormControl component="fieldset">
          <FormLabel component="legend" id="residence-relation" className="mb-1">
            {t("residence-field-relation")}
          </FormLabel>
          <RadioGroup
            aria-labelledby="residence-relation"
            name="relation"
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
      </Box>
    </SidePanel>
  );
}
