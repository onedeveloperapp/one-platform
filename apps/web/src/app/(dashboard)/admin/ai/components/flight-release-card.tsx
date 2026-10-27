"use client";

import { setFlightAlertsRelease } from "../actions";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import MetricBars from "@/components/product/metric-bars";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import type { FlightWatchStatus } from "@/lib/admin/ai";

const NUMBER = new Intl.NumberFormat("pt-BR");
const WHEN = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/**
 * The flights ONE follows and its first word to real passengers (migration
 * 0051). ONE reads each followed trip at FlightAware with the platform's key,
 * within a daily ceiling of reads; what it tells a real passenger (a trip
 * that is not a test chat's) waits for the operator's release, given here
 * with the note of the legal opinion on soliciting clients (the OAB's Code of
 * Ethics, art. 7, and Provimento 205/2021), and taken back the same way.
 * Closest to `AutonomyHoldCard`: a switch of the platform, on the record.
 */
export default function FlightReleaseCard({
  status,
  sourceOn,
  onChanged,
}: {
  status: FlightWatchStatus;
  /** FlightAware's key is in this environment. */
  sourceOn: boolean;
  onChanged: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const left = Math.max(status.dailyReads - status.readsToday, 0);

  return (
    <CollapsibleCard
      id="flight-release"
      title="Avisos de voo a passageiros reais"
      chip={
        <StatusChip
          tone={status.released ? "positive" : "attention"}
          label={status.released ? "Liberado" : "Bloqueado até a liberação"}
        />
      }
      summary={
        sourceOn
          ? `${NUMBER.format(status.readsToday)} de ${NUMBER.format(status.dailyReads)} leituras hoje · ${NUMBER.format(status.followingReal)} ${status.followingReal === 1 ? "viagem real acompanhada" : "viagens reais acompanhadas"}`
          : "Sem a chave da FlightAware neste ambiente"
      }
      description="O ONE lê na FlightAware os voos que acompanha e, quando a regra encontra um problema, escreve primeiro ao passageiro. O chat de teste recebe sempre; um passageiro real só depois da liberação, dada aqui com a nota do parecer jurídico sobre captação de clientela (Código de Ética da OAB, art. 7º, e Provimento 205/2021)."
      // Alerts kept for a real passenger wait for this card: they are what the operator comes to weigh.
      defaultOpen={status.heldAlerts > 0}
    >
      {status.released || status.releasedNote ? (
        <Typography variant="body2" className="text-text-secondary">
          {status.released ? "Liberado" : "Bloqueado de novo"}
          {status.releasedAt ? ` em ${WHEN.format(new Date(status.releasedAt))}` : ""}
          {status.releasedBy ? ` por ${status.releasedBy}` : ""}
          {status.releasedNote ? `: ${status.releasedNote}` : ""}
        </Typography>
      ) : null}

      {sourceOn ? (
        <UsageMeter
          headline={`${NUMBER.format(status.readsToday)} de ${NUMBER.format(status.dailyReads)} leituras hoje`}
          caption="Cada trecho lido na FlightAware é cobrado. O teto diário é configuração da plataforma."
          segments={[
            {
              key: "read",
              label: "Lidas hoje",
              value: status.readsToday,
              display: NUMBER.format(status.readsToday),
              tone: status.readsToday >= status.dailyReads ? "attention" : "primary",
            },
            { key: "left", label: "Restam", value: left, display: NUMBER.format(left), tone: "empty" },
          ]}
          ariaLabel="Leituras da FlightAware hoje"
        />
      ) : (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          A chave da FlightAware (FLIGHTAWARE_API_KEY) não está neste ambiente: nenhum voo é lido, nem o do chat de
          teste.
        </Alert>
      )}

      <MetricBars
        whole={false}
        items={[
          { key: "real", label: "Viagens reais acompanhadas", value: status.followingReal },
          { key: "test", label: "Voos de verdade em chats de teste", value: status.followingTest, tone: "secondary" },
          {
            key: "held",
            label: "Avisos guardados sem liberação",
            value: status.heldAlerts,
            tone: status.heldAlerts > 0 ? "attention" : "empty",
          },
        ]}
      />

      <Box>
        <Button
          variant={status.released ? "outlined" : "contained"}
          color={status.released ? "grey" : "primary"}
          onClick={() => setChanging(true)}
        >
          {status.released ? "Bloquear de novo" : "Liberar para passageiros reais"}
        </Button>
      </Box>
      {changing ? (
        <ReleaseDialog
          release={!status.released}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/** Releases ONE's first word to real passengers with the note of the legal opinion, or takes it back with why. */
function ReleaseDialog({ release, onClose, onDone }: { release: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setFlightAlertsRelease({ released: release, note });
      if (result.ok) onDone();
      else
        setProblem(
          result.code === "second_factor_required"
            ? "Confirme o segundo fator nesta sessão e tente de novo."
            : result.code === "note_required"
              ? "Escreva a nota com pelo menos 10 caracteres."
              : "Não foi possível registrar agora.",
        );
    } catch {
      setProblem("Não foi possível falar com o servidor agora.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="flight-release-dialog">
      <DialogHeader
        id="flight-release-dialog"
        title={release ? "Liberar avisos a passageiros reais" : "Bloquear de novo os avisos a passageiros reais"}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {release
            ? "Daqui em diante o ONE escreve primeiro aos passageiros reais quando o voo deles tiver um problema, em todos os escritórios, pelo modelo de cada escritório aprovado pela Meta. Os avisos guardados até agora não são enviados."
            : "Daqui em diante os avisos a passageiros reais voltam a ficar guardados, sem envio. O chat de teste continua recebendo."}
        </Typography>
        <TextField
          size="small"
          label={release ? "Nota do parecer jurídico" : "Motivo"}
          value={note}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value.slice(0, 1000))}
          helperText="De 10 a 1.000 caracteres. Fica no registro de auditoria."
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
        <Button variant="contained" disabled={busy || note.trim().length < 10} onClick={() => void submit()}>
          {release ? "Liberar" : "Bloquear"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
