"use client";

import { setTriagePolicy } from "../actions";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import InfoHint from "@/components/product/info-hint";
import StatusChip from "@/components/product/status-chip";
import {
  ACTING_CATEGORIES,
  meetsGoal,
  TRIAGE_CATEGORY_LABEL,
  type TriageCategory,
  type TriageMeasure,
} from "@/lib/admin/ai";
import { formatNumber, formatPercent, ratio } from "@/lib/admin/format";

const CODE_TEXT: Record<string, string> = {
  forbidden: "Esta sessão não muda a triagem.",
  reason_required: "Escreva a decisão, com pelo menos 8 letras.",
  below_goal: "A categoria não bate a meta agora: a medida mudou desde que a tela foi lida.",
  invalid_value: "A parte conferida vai de 1% a 100%.",
  acting_category:
    "Prazo, audiência, decisão e pagamento ficam sempre na sombra: o que vem depois da triagem é trabalho de uma pessoa.",
};

/**
 * Which categories of the AI's triage of publications are its own answer and
 * which stay in the shadow. The operator comes here to let a category out
 * when its measure met the goal, with the share a person checks, or to put
 * it back: so each category leads with where it stands against the goal, and
 * the one action it allows. A category that hid a deadline or a hearing went
 * back to the shadow by itself, and says when. A deadline, a hearing, a
 * decision and a payment never leave it: what follows their triage is a
 * person's work.
 *
 * Closest existing shape: the task cards of this console (a state and one
 * action each, with a dialog that asks the note); a category is smaller than
 * a task, so they share one card.
 */
export default function TriagePolicyCard({ measure, onChanged }: { measure: TriageMeasure; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ category: TriageCategory; mode: "shadow" | "sampled" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { goal } = measure;

  return (
    <Card component="section" aria-labelledby="ai-triage-policy" className="h-full">
      <CardContent className="flex h-full flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Box className="flex flex-row items-center gap-1">
            <Typography id="ai-triage-policy" variant="h5" component="h2" className="mb-0">
              Categorias da triagem da IA
            </Typography>
            <InfoHint label="Numa categoria liberada, a resposta da IA é a triagem da publicação que ninguém triou ainda, nos escritórios que permitem, e uma parte espera a conferência de uma pessoa. A primeira pessoa que acha um prazo, uma audiência, uma decisão ou um pagamento onde a IA disse outra coisa, conferindo ou triando ela mesma, devolve a categoria à sombra. Prazo, audiência, decisão e pagamento nunca saem da sombra." />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            Meta para liberar: {formatNumber(goal.minCompared)} publicações triadas por uma pessoa sem ver a resposta da
            IA nos últimos {formatNumber(goal.windowDays)} dias, {formatNumber(goal.minAgreedPercent)}% de concordância
            e no máximo {formatNumber(goal.maxMisses)}{" "}
            {goal.maxMisses === 1 ? "prazo ou audiência perdidos" : "prazos ou audiências perdidos"}. Aplicadas pela IA
            no período: {formatNumber(measure.applied)}; conferidas: {formatNumber(measure.checked)}; esperando
            conferência: {formatNumber(measure.waitingReview)}.
          </Typography>
        </Box>

        {notice ? (
          <Alert
            severity="success"
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setNotice(null)}
          >
            {notice}
          </Alert>
        ) : null}

        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {measure.byAiCategory.map((row) => {
            const ready = meetsGoal(row, goal);
            const acting = ACTING_CATEGORIES.has(row.category);
            return (
              <Box
                component="li"
                key={row.category}
                className="border-grey-100 flex flex-wrap items-center gap-2 border-b pb-2"
              >
                <Box className="min-w-0 flex-1">
                  <Typography variant="body2" className="font-semibold">
                    {TRIAGE_CATEGORY_LABEL[row.category] ?? row.category}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      `${formatNumber(row.compared)} comparadas`,
                      row.compared > 0 ? `${formatPercent(ratio(row.agreed, row.compared))} de concordância` : null,
                      `${formatNumber(row.misses)} ${row.misses === 1 ? "perdida" : "perdidas"}`,
                      row.demotedAt
                        ? `voltou à sombra em ${new Date(row.demotedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                </Box>
                <StatusChip
                  tone={row.mode === "sampled" ? "positive" : "neutral"}
                  label={
                    row.mode === "sampled"
                      ? `Liberada, ${row.samplePercent}% conferidas`
                      : acting
                        ? "Sempre em sombra"
                        : "Em sombra"
                  }
                />
                {acting ? null : row.mode === "sampled" ? (
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    onClick={() => setEditing({ category: row, mode: "shadow" })}
                  >
                    Voltar para a sombra
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    disabled={!ready}
                    onClick={() => setEditing({ category: row, mode: "sampled" })}
                  >
                    {ready ? "Liberar com amostra" : "Abaixo da meta"}
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      </CardContent>

      {editing ? (
        <PolicyDialog
          category={editing.category}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice(text);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function PolicyDialog({
  category,
  mode,
  onClose,
  onSaved,
}: {
  category: TriageCategory;
  mode: "shadow" | "sampled";
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [share, setShare] = useState(String(category.samplePercent || 20));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = TRIAGE_CATEGORY_LABEL[category.category] ?? category.category;
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setTriagePolicy({
        category: category.category,
        mode,
        samplePercent: Number(share),
        note,
      });
      if (!result.ok) {
        setProblem(CODE_TEXT[result.code] ?? "Não foi possível salvar agora.");
        return;
      }
      onSaved(
        mode === "sampled"
          ? `${label} liberada: a resposta da IA passa a ser a triagem, e ${share}% esperam conferência. Ficou no registro de auditoria.`
          : `${label} voltou para a sombra. Ficou no registro de auditoria.`,
      );
    } catch {
      setProblem("Não foi possível salvar agora.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="ai-triage-policy-dialog">
      <DialogHeader
        id="ai-triage-policy-dialog"
        title={mode === "sampled" ? `Liberar ${label} com amostra` : `Voltar ${label} para a sombra`}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {mode === "sampled"
            ? "A resposta da IA nesta categoria passa a ser a triagem das publicações que ninguém triou, nos escritórios que permitem. A parte abaixo espera a conferência de uma pessoa, e a primeira pessoa que achar um prazo, uma audiência, uma decisão ou um pagamento onde a IA disse outra coisa devolve a categoria à sombra."
            : "A resposta da IA nesta categoria volta a não decidir nada. O que ela já triou continua como está."}
        </Typography>
        {mode === "sampled" ? (
          <TextField
            size="small"
            label="Parte conferida por uma pessoa (%)"
            value={share}
            onChange={(event) => setShare(event.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        ) : null}
        <TextField
          size="small"
          label="A decisão, para o registro"
          value={note}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value.slice(0, 1000))}
          helperText="Por exemplo: a medida que justificou a mudança."
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {problem}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || note.trim().length < 8}>
          {mode === "sampled" ? "Liberar" : "Voltar para a sombra"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
