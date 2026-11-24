"use client";

import { AreaScriptEditor } from "./area-script-editor";
import { AreaScriptExamples, AreaScriptReview } from "./area-script-review";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Box, Button, FormControlLabel, Switch, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import QuickActions from "@/components/product/quick-actions";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import type { AreaScript } from "@/lib/areas/script";
import {
  type AreaScriptCard,
  type AreaScriptsState,
  copyAreaScript,
  finishAreaDocumentUpload,
  publishAreaScript,
  readAreaScripts,
  requestAreaScript,
  startAreaDocumentUpload,
  withdrawAreaScript,
} from "@/lib/areas/script-actions";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";

/** How often the step looks again while ONE writes. */
const WATCH_MS = 5000;

/** What a refused publication says, by its code; any other says it failed, naming the area. */
const PUBLISH_ERROR_KEY: Record<string, string> = {
  second_factor_required: "setup-operation-error-second_factor",
  copy_rules: "area-script-error-copy_rules",
  promise: "area-script-error-promise",
};
const MOST_DOCUMENTS = 3;
const DOCUMENT_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/**
 * The setup's step "Áreas" (migration 0273, phase 4 of the plan "o escritório preparado antes do primeiro
 * atendimento"): each area of the firm that no module serves gets a script of its own. ONE writes it by itself the
 * first time the step opens, from the area, the firm's lawsuits of it and its profile; the person reads it, corrects
 * it in place or asks ONE to change it (with a piece, the contract or the list of documents the firm asks), reads the
 * conversations of example written from it, and publishes it. An area with no script published yet goes on to a
 * person of the firm, with what the client needs (0257): the step never holds the setup.
 */
export function useAreasStep(input: { initial: AreaScriptsState | null; blocked: boolean }): Pick<
  WizardStep,
  "content" | "canAdvance" | "onPrimary" | "busy" | "primaryLabel" | "done"
> & {
  skippable: boolean;
} {
  const t = useTranslations("product");
  const [state, setState] = useState<AreaScriptsState | null>(input.initial);
  const asked = useRef(new Set<string>());

  const reread = async () => {
    const read = await readAreaScripts().catch(() => null);
    if (read) setState(read);
  };

  const writing = Boolean(state?.areas.some((area) => area.writing && area.writing.status !== "failed"));

  // ONE writes each area's script by itself the first time: nothing for the person to do but wait for it.
  useEffect(() => {
    if (input.blocked || !state) return;
    for (const area of state.areas) {
      if (area.draft || area.inForce || area.writing || asked.current.has(area.areaId)) continue;
      asked.current.add(area.areaId);
      void requestAreaScript({ areaId: area.areaId }).then((done) => {
        if (!done.ok) return;
        setState((current) =>
          current
            ? {
                ...current,
                areas: current.areas.map((one) =>
                  one.areaId === area.areaId ? { ...one, writing: { status: "waiting", failure: null } } : one,
                ),
              }
            : current,
        );
      });
    }
  }, [state, input.blocked]);

  // While ONE writes, the step looks again by itself.
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reread();
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [writing]);

  const pending = state?.areas.filter((area) => !area.inForce) ?? [];

  // ---------- What the step's button publishes ----------
  // Each draft ONE finished is published by the step's button unless the person turned its switch off: the button
  // says how many ("Publicar 1 roteiro e continuar"), and nothing inside the step publishes by itself.
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const drafts = (state?.areas ?? []).filter(
    (area) => area.draft && !(area.writing && area.writing.status !== "failed"),
  );
  const chosen = drafts.filter((area) => !off.has(area.draft!.id));

  const onPrimary = async (): Promise<boolean> => {
    if (chosen.length === 0 || input.blocked) return true;
    setPublishError(null);
    setPublishing(true);
    try {
      for (const area of chosen) {
        const done = await publishAreaScript(area.draft!.id).catch(() => ({ ok: false as const, code: "failed" }));
        if (!done.ok) {
          setPublishError(t(PUBLISH_ERROR_KEY[done.code] ?? "setup-areas-publish-failed", { area: area.name }));
          await reread();
          return false;
        }
      }
      await reread();
      return true;
    } finally {
      setPublishing(false);
    }
  };

  const content = !state ? (
    <StateLine tone="failed">{t("setup-areas-unreadable")}</StateLine>
  ) : (
    <Box className="flex flex-col gap-4">
      {state.areas.length === 0 ? (
        <StateLine tone="done">{t("setup-areas-none")}</StateLine>
      ) : (
        state.areas.map((area) => (
          <AreaCard
            key={area.areaId}
            area={area}
            blocked={input.blocked}
            onChanged={reread}
            publish={area.draft ? !off.has(area.draft.id) : null}
            onPublish={(value) =>
              setOff((current) => {
                const next = new Set(current);
                if (value) next.delete(area.draft!.id);
                else next.add(area.draft!.id);
                return next;
              })
            }
          />
        ))
      )}
      {state.moduleAreas.length > 0 ? (
        <StateLine tone="info">{t("setup-areas-modules", { list: state.moduleAreas.join(" · ") })}</StateLine>
      ) : null}
      {pending.length > 0 ? (
        <StateLine tone="info">{t("setup-areas-pending", { count: pending.length })}</StateLine>
      ) : null}
      {publishError ? (
        <Box role="alert">
          <StateLine tone="failed">{publishError}</StateLine>
        </Box>
      ) : null}
    </Box>
  );

  return {
    content,
    canAdvance: !input.blocked,
    onPrimary,
    busy: publishing,
    primaryLabel: chosen.length > 0 ? t("setup-areas-publish-continue", { count: chosen.length }) : undefined,
    done: Boolean(state) && pending.length === 0,
    skippable: chosen.length > 0,
  };
}

/** One area of the firm: where its script stands, and what the person does with it. */
function AreaCard({
  area,
  blocked,
  onChanged,
  publish,
  onPublish,
}: {
  area: AreaScriptCard;
  blocked: boolean;
  onChanged: () => Promise<void>;
  /** Whether the step's button publishes this area's draft; null with no draft to publish. */
  publish: boolean | null;
  onPublish: (value: boolean) => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState<{ id: string; script: AreaScript } | null>(null);
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [examples, setExamples] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const writing = area.writing && area.writing.status !== "failed";
  const shown = area.draft ?? area.inForce;
  const id = `area-${area.areaId.slice(0, 8)}`;

  const errorOf = (code: string) =>
    code === "second_factor_required"
      ? t("setup-operation-error-second_factor")
      : code === "type_not_allowed"
        ? t("setup-areas-error-type")
        : code === "too_large"
          ? t("setup-areas-error-size")
          : code === "too_many_files"
            ? t("setup-areas-error-files")
            : code === "copy_rules"
              ? t("area-script-error-copy_rules")
              : code === "promise"
                ? t("area-script-error-promise")
                : t("setup-operation-error-failed");

  const act = async (work: () => Promise<{ ok: boolean; code?: string }>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    const done = await work().catch(() => ({ ok: false, code: "failed" }));
    setBusy(false);
    if (!done.ok) {
      setError(errorOf("code" in done ? (done.code ?? "failed") : "failed"));
      return false;
    }
    await onChanged();
    return true;
  };

  const send = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(list).slice(0, MOST_DOCUMENTS - files.length)) {
        const mime = mimeOf(file);
        const started = await startAreaDocumentUpload({ name: file.name, mime, bytes: file.size });
        if (!started.ok) {
          setError(errorOf(started.code));
          return;
        }
        const sent = await uploadToSignedUrl({
          storagePath: started.storagePath,
          uploadToken: started.uploadToken,
          file,
          contentType: mime,
        });
        const kept = sent ? await finishAreaDocumentUpload(started.fileId) : { ok: false as const, code: "failed" };
        if (!kept.ok) {
          setError(errorOf(kept.code));
          return;
        }
        setFiles((current) => [...current, { id: started.fileId, name: file.name }]);
      }
    } catch {
      setError(errorOf("failed"));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const ask = async () => {
    const done = await act(() =>
      requestAreaScript({ areaId: area.areaId, change: change.trim() || null, fileIds: files.map((file) => file.id) }),
    );
    if (done) {
      setChanging(false);
      setChange("");
      setFiles([]);
      setExamples(false);
    }
  };

  const correct = async () => {
    if (area.draft) {
      setEditing({ id: area.draft.id, script: area.draft.script });
      return;
    }
    if (!area.inForce) return;
    setError(null);
    setBusy(true);
    const copied = await copyAreaScript(area.inForce.id).catch(() => ({ ok: false as const, code: "failed" }));
    setBusy(false);
    if (!copied.ok) {
      setError(errorOf(copied.code));
      return;
    }
    setEditing({ id: copied.scriptId, script: area.inForce.script });
    await onChanged();
  };

  const chip = writing ? (
    <StatusChip label={t("setup-areas-chip-writing")} tone="info" />
  ) : area.draft ? (
    <StatusChip label={t("setup-areas-chip-draft")} tone="attention" />
  ) : area.inForce ? (
    <StatusChip label={t("setup-areas-chip-published", { version: area.inForce.version })} tone="positive" />
  ) : area.writing?.status === "failed" ? (
    <StatusChip label={t("setup-areas-chip-failed")} tone="danger" />
  ) : (
    <StatusChip label={t("setup-areas-chip-none")} tone="neutral" />
  );

  return (
    <CollapsibleCard
      id={id}
      title={area.name}
      titleAs="h3"
      chip={chip}
      description={area.covers ? t("setup-areas-covers", { covers: area.covers }).slice(0, 200) : undefined}
      defaultOpen={Boolean(area.draft) || !area.inForce}
      action={
        area.inForce && !area.draft && !writing ? (
          <QuickActions
            label={t("setup-areas-more", { area: area.name })}
            actions={[
              {
                key: "withdraw",
                label: t("setup-areas-withdraw"),
                onClick: () => setWithdrawing(true),
                disabled: blocked,
              },
            ]}
          />
        ) : undefined
      }
    >
      <Box className="flex flex-col gap-4">
        {writing ? (
          <StateLine tone="waiting">{t("setup-areas-writing")}</StateLine>
        ) : area.writing?.status === "failed" && !shown ? (
          <StateLine
            tone="failed"
            action={
              <Button variant="outlined" size="small" onClick={() => void ask()} disabled={blocked || busy}>
                {t("setup-personality-retry")}
              </Button>
            }
          >
            {t("setup-areas-failed")}
          </StateLine>
        ) : area.draft ? (
          <StateLine tone="attention">{t("setup-areas-check")}</StateLine>
        ) : area.inForce ? (
          <StateLine tone="done">{t("setup-areas-published")}</StateLine>
        ) : null}

        {shown && !writing ? <AreaScriptReview id={id} script={shown.script} /> : null}

        {shown && !writing && examples ? (
          <AreaScriptExamples id={id} script={shown.script} areaName={area.name} />
        ) : null}

        {shown && !writing ? (
          changing ? (
            <Box className="flex flex-col gap-3">
              <TextField
                id={`${id}-change`}
                label={t("setup-areas-change-label")}
                value={change}
                onChange={(event) => setChange(event.target.value)}
                multiline
                minRows={3}
                variant="standard"
                className="outlined"
                helperText={t("setup-areas-change-help")}
                disabled={blocked || busy}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
              />
              <Box className="flex flex-col gap-2">
                <input
                  ref={picker}
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  multiple
                  hidden
                  onChange={(event) => void send(event.target.files)}
                />
                {files.map((file) => (
                  <StateLine key={file.id} tone="done">
                    {t("setup-areas-document-sent", { name: file.name })}
                  </StateLine>
                ))}
                {files.length < MOST_DOCUMENTS ? (
                  <Box>
                    <Button
                      variant="text"
                      startIcon={<NiUploadCloud size="small" />}
                      onClick={() => picker.current?.click()}
                      disabled={blocked || busy}
                    >
                      {t("setup-areas-send-document")}
                    </Button>
                  </Box>
                ) : null}
                <Typography variant="caption" className="text-text-secondary">
                  {t("setup-areas-documents-help")}
                </Typography>
              </Box>
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant="outlined"
                  onClick={() => void ask()}
                  disabled={blocked || busy || (!change.trim() && files.length === 0)}
                >
                  {t("setup-areas-rewrite")}
                </Button>
                <Button variant="text" onClick={() => setChanging(false)} disabled={busy}>
                  {t("setup-personality-cancel")}
                </Button>
              </Box>
            </Box>
          ) : (
            // Nothing here publishes: the switch says whether the step's button publishes this script (the owner's
            // canvas of 2026-11-24, where "Publicar" inside the step and "Continuar" below it left drafts behind).
            <Box className="flex flex-wrap items-center justify-between gap-2">
              <Box className="flex flex-wrap gap-1">
                <Button variant="text" color="grey" onClick={() => setExamples(!examples)} disabled={busy}>
                  {t(examples ? "setup-areas-hide-examples" : "setup-areas-see-examples")}
                </Button>
                <Button variant="text" color="grey" onClick={() => void correct()} disabled={blocked || busy}>
                  {t("setup-areas-correct")}
                </Button>
                <Button variant="text" color="grey" onClick={() => setChanging(true)} disabled={blocked || busy}>
                  {t("setup-areas-ask-change")}
                </Button>
              </Box>
              {area.draft && publish !== null ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={publish}
                      onChange={(event) => onPublish(event.target.checked)}
                      disabled={blocked || busy}
                    />
                  }
                  label={t("setup-areas-publish-this")}
                  className="m-0"
                />
              ) : null}
            </Box>
          )
        ) : null}

        {error ? <StateLine tone="failed">{error}</StateLine> : null}
      </Box>

      {editing ? (
        <AreaScriptEditor
          open
          areaName={area.name}
          scriptId={editing.id}
          initial={editing.script}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setExamples(false);
            void onChanged();
          }}
        />
      ) : null}

      {withdrawing && area.inForce ? (
        <ConfirmActionDialog
          title={t("setup-areas-withdraw-title", { area: area.name, version: area.inForce.version })}
          consequences={[t("setup-areas-withdraw-consequence-new"), t("setup-areas-withdraw-consequence-cases")]}
          staysTitle={t("setup-areas-withdraw-stays-title")}
          stays={[t("setup-areas-withdraw-stays")]}
          reasonLabel={t("setup-areas-withdraw-reason")}
          reasonHelp={t("setup-areas-withdraw-reason-help")}
          reasonMinLength={3}
          confirmLabel={t("setup-areas-withdraw-confirm")}
          cancelLabel={t("setup-personality-cancel")}
          busyLabel={t("setup-areas-withdraw-busy")}
          onConfirm={async (reason) => {
            const done = await act(() => withdrawAreaScript({ scriptId: area.inForce!.id, reason }));
            if (!done) return t("setup-operation-error-failed");
            setWithdrawing(false);
            return null;
          }}
          onClose={() => setWithdrawing(false)}
        />
      ) : null}
    </CollapsibleCard>
  );
}
