"use client";

import { publishPromptVersion } from "../actions";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import {
  type AiTaskMeasure,
  PROMPT_EFFORTS,
  PROMPT_PROVIDERS,
  type PromptDraft,
  promptDraftProblem,
  type PromptVersion,
} from "@/lib/admin/ai";

const FAILURE: Record<string, string> = {
  forbidden: "Só quem tem o papel de superadmin publica instruções, e nunca de dentro de uma sessão de suporte.",
  not_authorized: "Só quem tem o papel de superadmin publica instruções, e nunca de dentro de uma sessão de suporte.",
  unknown_task: "Esta tarefa não existe no catálogo.",
  failed: "O banco não aceitou a versão agora. Nada foi publicado.",
};

/**
 * Writes the next version of a task's instructions, starting from the one in
 * force. What is published is in force at once for every firm and never
 * changes afterwards: each run names the version it used, and a correction
 * is the next version. The note says what changed and why, and stays in the
 * audit trail with it.
 */
export default function TaskInstructionsDialog({
  task,
  active,
  onClose,
  onPublished,
}: {
  task: AiTaskMeasure;
  active: PromptVersion | null;
  onClose: () => void;
  onPublished: (version: number) => void;
}) {
  const [draft, setDraft] = useState<PromptDraft>({
    task: task.task,
    provider: active?.provider ?? "anthropic",
    model: active?.model ?? "",
    effort: active?.effort ?? null,
    systemPrompt: active?.systemPrompt ?? "",
    outputSchema: active ? JSON.stringify(active.outputSchema, null, 2) : "",
    maxTokens: active?.maxTokens ?? 2048,
    note: "",
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const problem = promptDraftProblem(draft);
  const shown = tried ? problem : null;
  const set = <K extends keyof PromptDraft>(key: K, value: PromptDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const errorOf = (field: keyof PromptDraft) => (shown?.field === field ? shown.message : undefined);

  const publish = async () => {
    setTried(true);
    if (problem || busy) return;
    setBusy(true);
    setFailure(null);
    const result = await publishPromptVersion(draft);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.message ?? FAILURE[result.code] ?? FAILURE.failed);
      return;
    }
    onPublished(result.version ?? 0);
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="task-instructions-title">
      <DialogHeader
        id="task-instructions-title"
        title={`Nova versão: ${task.name}`}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Typography variant="body1" className="text-text-secondary">
            {active
              ? `Parte da versão ${active.version}, em vigor. Ao publicar, a nova versão passa a valer para todos os escritórios, e a anterior fica registrada como estava.`
              : "Esta tarefa não tem instruções em vigor. A primeira versão publicada passa a valer para todos os escritórios."}
          </Typography>
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <TextField
              select
              size="small"
              id="task-instructions-provider"
              label="Provedor"
              value={draft.provider}
              onChange={(event) => set("provider", event.target.value)}
              error={Boolean(errorOf("provider"))}
              helperText={errorOf("provider")}
              disabled={busy}
            >
              {PROMPT_PROVIDERS.map((provider) => (
                <MenuItem key={provider} value={provider}>
                  {provider}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              id="task-instructions-model"
              label="Modelo"
              value={draft.model}
              onChange={(event) => set("model", event.target.value)}
              error={Boolean(errorOf("model"))}
              helperText={errorOf("model")}
              disabled={busy}
            />
            <TextField
              select
              size="small"
              id="task-instructions-effort"
              label="Esforço"
              value={draft.effort ?? ""}
              onChange={(event) => set("effort", event.target.value || null)}
              error={Boolean(errorOf("effort"))}
              helperText={errorOf("effort")}
              disabled={busy}
            >
              <MenuItem value="">nenhum</MenuItem>
              {PROMPT_EFFORTS.map((effort) => (
                <MenuItem key={effort} value={effort}>
                  {effort}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              id="task-instructions-tokens"
              label="Limite da resposta (tokens)"
              value={Number.isFinite(draft.maxTokens) ? draft.maxTokens : ""}
              onChange={(event) => set("maxTokens", Number.parseInt(event.target.value, 10))}
              error={Boolean(errorOf("maxTokens"))}
              helperText={errorOf("maxTokens")}
              disabled={busy}
            />
          </Box>
          <TextField
            fullWidth
            multiline
            minRows={8}
            maxRows={20}
            size="small"
            id="task-instructions-prompt"
            label="Instruções"
            value={draft.systemPrompt}
            onChange={(event) => set("systemPrompt", event.target.value)}
            error={Boolean(errorOf("systemPrompt"))}
            helperText={errorOf("systemPrompt")}
            disabled={busy}
          />
          <TextField
            fullWidth
            multiline
            minRows={6}
            maxRows={16}
            size="small"
            id="task-instructions-schema"
            label="Formato da resposta (JSON Schema)"
            value={draft.outputSchema}
            onChange={(event) => set("outputSchema", event.target.value)}
            error={Boolean(errorOf("outputSchema"))}
            helperText={errorOf("outputSchema") ?? "Os campos que o código da tarefa lê continuam obrigatórios."}
            disabled={busy}
            slotProps={{ htmlInput: { className: "font-mono", spellCheck: false } }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            id="task-instructions-note"
            label="O que muda nesta versão, e por quê"
            value={draft.note}
            onChange={(event) => set("note", event.target.value)}
            error={Boolean(errorOf("note"))}
            helperText={errorOf("note") ?? "Fica no registro de auditoria com a versão."}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {failure ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {failure}
            </Alert>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void publish()} disabled={busy}>
          {busy ? "Publicando" : "Publicar e pôr em vigor"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
