"use client";

import { setAutonomyHold } from "../actions";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip from "@/components/product/status-chip";
import type { AutonomyCatalogEntry } from "@/lib/admin/ai";

/** What each decision is, for the operator. */
const DECISION_LABEL: Record<string, string> = {
  reply_client: "Responder o cliente na conversa",
  open_case_from_chat: "Abrir o caso pela conversa",
  open_case_from_djen: "Abrir o caso dos processos do DJEN",
  send_client_link: "Enviar o link ao cliente",
  send_signature_papers: "Enviar a procuração e o contrato para o cliente assinar",
  document_check: "Aceitar ou recusar documentos",
  chronology: "Mandar a cronologia ao cliente",
  piece_text: "Aprovar o primeiro texto da peça",
  deadline_confirm: "Confirmar prazos",
  file_or_hold: "Protocolar ou segurar (Tema 1.417)",
  create_lawsuits: "Criar as ações do caso",
  start_piece: "Pedir a peça à IA",
  request_package: "Montar o pacote de protocolo",
  sign_package: "Assinar os arquivos do protocolo",
  publication_deadline: "Propor o prazo de uma publicação",
  publication_hearing: "Registrar a audiência de uma publicação",
};
const labelOf = (key: string) => DECISION_LABEL[key] ?? key;

/**
 * What ONE decides alone in the firms (migration 0016): each firm chooses,
 * and by default ONE decides. The operator comes here when a decision's
 * measure falls: holding it has a person decide it in every firm, with the
 * reason on record, until it is let go. Each firm's own choice stays. A
 * decision an AI task takes is also held when the task's autonomy is set to
 * approval in its own dialog above.
 */
export default function AutonomyHoldCard({
  catalog,
  onChanged,
}: {
  catalog: AutonomyCatalogEntry[];
  onChanged: () => void;
}) {
  const [changing, setChanging] = useState<{ entry: AutonomyCatalogEntry; held: boolean } | null>(null);
  const held = catalog.filter((entry) => entry.held || entry.taskHeld).length;

  return (
    <CollapsibleCard
      id="autonomy-hold"
      title="O que o ONE decide sozinho nos escritórios"
      chip={
        held > 0 ? <StatusChip label={`${held} ${held === 1 ? "segurada" : "seguradas"}`} tone="attention" /> : null
      }
      summary={
        held > 0
          ? `Uma pessoa decide em todos os escritórios ${held === 1 ? "uma decisão" : `${held} decisões`} de ${catalog.length}`
          : `Cada escritório escolhe as ${catalog.length} decisões`
      }
      description="Cada escritório escolhe em Configurações; por padrão o ONE decide. Segurar uma decisão faz uma pessoa decidir em todos os escritórios até ela ser liberada. A escolha de cada escritório fica guardada."
      bodyClassName="gap-3"
    >
      {catalog.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          Nenhuma decisão no catálogo.
        </Typography>
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {catalog.map((entry) => (
            <Box
              component="li"
              key={entry.key}
              className="border-grey-100 flex flex-wrap items-center gap-3 border-b pb-2 last:border-b-0"
            >
              <Box className="min-w-0 flex-1">
                <Typography variant="body2" className="font-semibold">
                  {labelOf(entry.key)}
                </Typography>
                {entry.held && entry.heldNote ? (
                  <Typography variant="body2" className="text-text-secondary">
                    Segurada: {entry.heldNote}
                  </Typography>
                ) : null}
                {entry.taskHeld ? (
                  <Typography variant="body2" className="text-text-secondary">
                    A tarefa de IA desta decisão está em aprovação: uma pessoa decide em todos os escritórios.
                  </Typography>
                ) : null}
              </Box>
              <StatusChip
                tone={entry.held || entry.taskHeld ? "attention" : "positive"}
                label={entry.held || entry.taskHeld ? "Uma pessoa decide em todos" : "Cada escritório escolhe"}
              />
              <Button
                variant="text"
                color="grey"
                size="small"
                aria-label={`${entry.held ? "Liberar" : "Segurar"}: ${labelOf(entry.key)}`}
                onClick={() => setChanging({ entry, held: !entry.held })}
              >
                {entry.held ? "Liberar" : "Segurar"}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      {changing ? (
        <HoldDialog
          entry={changing.entry}
          held={changing.held}
          onClose={() => setChanging(null)}
          onDone={() => {
            setChanging(null);
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/** Holds a decision for every firm with the reason, or lets it go after a confirmation. */
function HoldDialog({
  entry,
  held,
  onClose,
  onDone,
}: {
  entry: AutonomyCatalogEntry;
  held: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setAutonomyHold({ key: entry.key, held, note });
      if (!result.ok) setProblem(held ? "Não foi possível segurar agora." : "Não foi possível liberar agora.");
      else onDone();
    } catch {
      setProblem("Não foi possível falar com o servidor agora.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="autonomy-hold-dialog">
      <DialogHeader
        id="autonomy-hold-dialog"
        title={`${held ? "Segurar" : "Liberar"}: ${labelOf(entry.key)}`}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {held
            ? "Uma pessoa passa a decidir isto em todos os escritórios. O que o ONE já decidiu fica como está."
            : "Cada escritório volta a decidir isto como escolheu, e o ONE volta a decidir onde o escritório deixa."}
        </Typography>
        {held ? (
          <TextField
            size="small"
            label="Motivo"
            value={note}
            multiline
            minRows={2}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            helperText="Entre 8 e 500 caracteres. Fica no registro de auditoria."
          />
        ) : null}
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
        <Button variant="contained" disabled={busy || (held && note.trim().length < 8)} onClick={() => void submit()}>
          {held ? "Segurar" : "Liberar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
