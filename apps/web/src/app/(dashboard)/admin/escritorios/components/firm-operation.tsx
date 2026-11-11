"use client";

import { type FirmOperation, loadFirmOperation } from "../operation-actions";
import { useEffect, useState } from "react";

import { Alert, Box, Skeleton, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { formatUsdMicros } from "@/lib/admin/ai";
import { formatDateTime, formatNumber } from "@/lib/admin/format";

const METRIC_LABEL: Record<string, string> = {
  processos_ativos: "Processos ativos",
  assentos: "Pessoas na equipe",
  whatsapp_numeros: "Números de WhatsApp",
};

/**
 * One firm's operation in its dossier (migration 0204): its use against its tier, its cases, its WhatsApp, the cost
 * of its AI this month, its connections, its DJEN readings, and whether it let the support in (0203). Read when the
 * dossier opens; counts and states only.
 */
export default function FirmOperationSection({ orgId }: { orgId: string }) {
  const [operation, setOperation] = useState<FirmOperation | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void loadFirmOperation(orgId)
      .then((read) => live && setOperation(read.ok ? read.operation : null))
      .catch(() => live && setOperation(null));
    return () => {
      live = false;
    };
  }, [orgId]);

  return (
    <Box component="section" className="flex flex-col gap-3">
      <Typography variant="h6" component="h3" className="mb-0">
        Operação
      </Typography>
      {operation === undefined ? (
        <Skeleton variant="rounded" height={120} />
      ) : operation === null ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          Não foi possível ler a operação deste escritório agora.
        </Alert>
      ) : (
        <>
          <Box className="flex flex-row flex-wrap gap-2">
            {operation.supportUntil ? (
              <StatusChip tone="attention" label={`Suporte autorizado até ${formatDateTime(operation.supportUntil)}`} />
            ) : (
              <StatusChip tone="neutral" label="Suporte não autorizado" />
            )}
            {operation.alertsMonth > 0 ? (
              <StatusChip tone="attention" label={`${formatNumber(operation.alertsMonth)} alertas de faixa no mês`} />
            ) : null}
            {operation.whatsapp.failed7d > 0 ? (
              <StatusChip
                tone="danger"
                label={`${formatNumber(operation.whatsapp.failed7d)} envios falharam em 7 dias`}
              />
            ) : null}
            {operation.calendar && operation.calendar !== "active" ? (
              <StatusChip tone="attention" label={`Agenda: ${operation.calendar}`} />
            ) : null}
            {operation.djen.stopped > 0 ? (
              <StatusChip tone="attention" label={`${formatNumber(operation.djen.stopped)} leituras do DJEN paradas`} />
            ) : null}
          </Box>
          <Box component="dl" className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ...operation.usage.map(
                (line) =>
                  [
                    METRIC_LABEL[line.metric] ?? line.metric,
                    line.ceiling
                      ? `${formatNumber(line.now)} de ${formatNumber(line.ceiling)}`
                      : `${formatNumber(line.now)}, sem limite`,
                  ] as [string, string],
              ),
              ["Casos abertos no mês", formatNumber(operation.cases.openedMonth)] as [string, string],
              ["Casos de teste", formatNumber(operation.cases.tests)] as [string, string],
              [
                "WhatsApp em 30 dias",
                `${formatNumber(operation.whatsapp.in30d)} recebidas, ${formatNumber(operation.whatsapp.out30d)} enviadas`,
              ] as [string, string],
              [
                "Números",
                operation.whatsapp.numbers.length === 0
                  ? "nenhum"
                  : operation.whatsapp.numbers.map((number) => `${number.provider} (${number.status})`).join(" · "),
              ] as [string, string],
              [
                "IA neste mês",
                `${formatNumber(operation.ai.runsMonth)} execuções, ${formatUsdMicros(operation.ai.costUsdMicrosMonth)}`,
              ] as [string, string],
              [
                "Conexões",
                operation.connections.length === 0
                  ? "nenhuma"
                  : operation.connections
                      .map((connection) => `${connection.provider} (${connection.status})`)
                      .join(" · "),
              ] as [string, string],
              ["Leituras do DJEN", formatNumber(operation.djen.reading)] as [string, string],
            ].map(([label, value]) => (
              <Box key={label} className="flex min-w-0 flex-col">
                <Typography component="dt" variant="body2" className="text-text-secondary">
                  {label}
                </Typography>
                <Typography component="dd" variant="body1" className="m-0 break-words">
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
