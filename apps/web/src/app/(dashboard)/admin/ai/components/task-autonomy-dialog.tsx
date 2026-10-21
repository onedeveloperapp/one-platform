"use client";

import { setTaskAutonomy } from "../actions";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { acceptedShare, type AiAutonomy, type AiTaskMeasure, decidedCount } from "@/lib/admin/ai";
import { formatNumber, formatPercent } from "@/lib/admin/format";

const OPTIONS: { value: AiAutonomy; label: string; help: string }[] = [
  {
    value: "approval",
    label: "Toda resposta espera uma pessoa",
    help: "Toda resposta da tarefa espera alguém do escritório, em todos os escritórios.",
  },
  {
    value: "sampled",
    label: "Uma amostra espera uma pessoa",
    help: "A parte sorteada vai para a fila e continua medindo a tarefa; o resto age como veio.",
  },
  {
    value: "autonomous",
    label: "Sem teto da plataforma",
    help: "Na conferência de documentos e na cronologia vale a escolha de cada escritório, em Configurações; as outras tarefas agem sozinhas.",
  },
];

const FAILURE: Record<string, string> = {
  forbidden: "Só quem tem o papel de superadmin muda a autonomia, e nunca de dentro de uma sessão de suporte.",
  not_authorized: "Só quem tem o papel de superadmin muda a autonomia, e nunca de dentro de uma sessão de suporte.",
  reason_required: "Escreva o motivo, com a medida que o justifica (pelo menos 8 caracteres).",
  invalid: "Escolha uma opção, e para a amostra uma porcentagem de 1 a 100.",
  unknown_task: "Esta tarefa não existe no catálogo.",
  failed: "O banco não aceitou a mudança agora. Nada foi alterado.",
};

/**
 * How much of what a task answers waits for a person, as the platform's
 * ceiling: since the owner's decision of 2026-10-14 each firm chooses how
 * much ONE decides alone (0016), and this setting holds the task's answers
 * for every firm (everything waits) or samples them in every firm. The
 * measure shows beside the choice, and the reason stays in the audit trail.
 * The piece, the deadlines and the decision to file are held in the card of
 * what ONE decides alone.
 */
export default function TaskAutonomyDialog({
  task,
  onClose,
  onSaved,
}: {
  task: AiTaskMeasure;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [autonomy, setAutonomy] = useState<AiAutonomy>(task.autonomy);
  const [percent, setPercent] = useState<number>(task.autonomy === "sampled" ? task.samplePercent : 20);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const share = acceptedShare(task);

  const save = async () => {
    setBusy(true);
    setFailure(null);
    const result = await setTaskAutonomy({ task: task.task, autonomy, samplePercent: percent, note });
    setBusy(false);
    if (!result.ok) {
      setFailure(FAILURE[result.code] ?? FAILURE.failed);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="task-autonomy-title">
      <DialogHeader id="task-autonomy-title" title={`Autonomia: ${task.name}`} onClose={onClose} closeLabel="Fechar" />
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Typography variant="body1" className="text-text-secondary">
            {share === null
              ? "Ninguém decidiu uma resposta desta tarefa no período: ainda não há medida para dar autonomia."
              : `Aceitas como vieram: ${formatPercent(share)} das ${formatNumber(decidedCount(task))} decididas no período.`}
          </Typography>
          <RadioGroup
            aria-label="Quanto espera uma pessoa"
            value={autonomy}
            onChange={(event) => setAutonomy(event.target.value as AiAutonomy)}
          >
            {OPTIONS.map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                disabled={busy}
                control={<Radio />}
                label={
                  <Box className="flex flex-col py-1">
                    <Typography variant="body1">{option.label}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {option.help}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
          {autonomy === "sampled" ? (
            <TextField
              size="small"
              type="number"
              id="task-autonomy-percent"
              label="Porcentagem que espera uma pessoa"
              value={Number.isFinite(percent) ? percent : ""}
              onChange={(event) => setPercent(Number.parseInt(event.target.value, 10))}
              disabled={busy}
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
            />
          ) : null}
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            id="task-autonomy-note"
            label="Motivo, com a medida que o justifica"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            helperText="Fica no registro de auditoria com a mudança."
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
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={
            busy ||
            note.trim().length < 8 ||
            (autonomy === task.autonomy && (autonomy !== "sampled" || percent === task.samplePercent))
          }
        >
          {busy ? "Salvando" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
