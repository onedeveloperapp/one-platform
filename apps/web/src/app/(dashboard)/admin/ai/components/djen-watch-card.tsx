"use client";

import { readDjenWatchAdmin } from "../djen-watch-actions";
import { useEffect, useState } from "react";

import { Alert, Box, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import InfoHint from "@/components/product/info-hint";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import IllustrationServers from "@/icons/illustrations/illustration-servers";
import { formatDate, formatNumber } from "@/lib/admin/format";
import type { DjenWatch } from "@/lib/publications/djen-watch";

const SYSTEM: Record<string, string> = {
  projudi: "Projudi",
  eproc: "eproc",
  pje: "PJe",
  esaj: "e-SAJ",
  outro: "outro sistema",
};

const KIND: Record<string, string> = { juizado: "juizado", comum: "vara cível" };

const OUTCOME: Record<string, { label: string; tone: "positive" | "attention" | "neutral" }> = {
  ok: { label: "Respondeu", tone: "positive" },
  error: { label: "Falhou", tone: "attention" },
  rate_limited: { label: "Limitou", tone: "neutral" },
};

/**
 * The watch over the DJEN (migration 0201): once an hour the platform looks at what one state court made available,
 * the courts in turn. The operator reads here whether the DJEN answers, since when it does not, whether it publishes
 * its texts empty, and which courts' links now point to another system than the table says, to check the court's act
 * and update the table. The firms are told of an outage only past a day; the operator, at once.
 */
export default function DjenWatchCard({ captureOn }: { captureOn: boolean }) {
  const [watch, setWatch] = useState<DjenWatch | null>(null);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    void readDjenWatchAdmin()
      .then((read) => (read.ok ? setWatch(read.watch) : setProblem(true)))
      .catch(() => setProblem(true));
  }, []);

  const trouble = watch?.downSince
    ? "O DJEN não responde"
    : watch?.empty
      ? "Textos vazios"
      : watch && watch.signals.length > 0
        ? `${formatNumber(watch.signals.length)} ${watch.signals.length === 1 ? "sinal" : "sinais"} de troca de sistema`
        : null;

  return (
    <CollapsibleCard
      id="ai-djen-watch"
      title="Vigia do DJEN"
      chip={
        <>
          <InfoHint label="Uma consulta por hora à API pública do DJEN, um tribunal estadual por vez. Diz se o DJEN responde, se publica textos vazios e para qual sistema os links de cada tribunal apontam." />
          {trouble ? <StatusChip label={trouble} tone="attention" /> : null}
        </>
      }
      summary={
        watch?.lastProbeAt
          ? `Última consulta em ${formatDate(watch.lastProbeAt)}, ${formatNumber(watch.courtsSeen)} tribunais vistos`
          : "Nenhuma consulta feita ainda"
      }
      defaultOpen={trouble !== null}
      bodyClassName="gap-4"
    >
      {!captureOn ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Este ambiente não lê o DJEN, então a vigia não consulta nada aqui.
        </Alert>
      ) : null}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          Não foi possível ler a vigia agora.
        </Alert>
      ) : null}
      {watch ? (
        <>
          {watch.downSince ? (
            <StateLine tone="failed" emphasis>
              {`O DJEN não responde desde ${formatDate(watch.downSince)}. Os escritórios que leem o DJEN são avisados depois de um dia sem resposta.`}
            </StateLine>
          ) : watch.lastOkAt ? (
            <StateLine tone="done">{`O DJEN respondeu pela última vez em ${formatDate(watch.lastOkAt)}.`}</StateLine>
          ) : null}
          {watch.dayItems > 0 ? (
            <Box className="flex flex-col gap-1">
              <UsageMeter
                headline={`${formatNumber(watch.dayWithoutText)} de ${formatNumber(watch.dayItems)} sem texto`}
                ariaLabel="Comunicações sem texto nas últimas 24 horas"
                segments={[
                  {
                    key: "empty",
                    label: "Sem texto",
                    value: watch.dayWithoutText,
                    display: formatNumber(watch.dayWithoutText),
                    tone: "attention",
                  },
                  {
                    key: "full",
                    label: "Com texto",
                    value: watch.dayItems - watch.dayWithoutText,
                    display: formatNumber(watch.dayItems - watch.dayWithoutText),
                    tone: "primary",
                  },
                ]}
              />
            </Box>
          ) : null}

          <Box className="flex flex-col gap-2">
            <Typography variant="subtitle2" component="h3">
              Sinais de troca de sistema
            </Typography>
            {watch.signals.length === 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                Os links de cada tribunal concordam com a tabela de sistemas.
              </Typography>
            ) : (
              watch.signals.map((signal) => (
                <StateLine key={`${signal.court}:${signal.kind}`} tone="attention">
                  {`${signal.court}, ${KIND[signal.kind]}: ${signal.percent}% dos links levam ao ${SYSTEM[signal.seenSystem]} (${formatNumber(signal.seen)} de ${formatNumber(signal.total)}${signal.firstSeen ? `, desde ${formatDate(signal.firstSeen)}` : ""}). A tabela diz ${signal.tableSystem ? SYSTEM[signal.tableSystem] : "nada"}${signal.confirmed ? ", conferida" : ""}. Confira o ato do tribunal em Calendário e tribunais.`}
                </StateLine>
              ))
            )}
          </Box>

          <Box className="flex flex-col gap-2">
            <Typography variant="subtitle2" component="h3">
              Últimas consultas
            </Typography>
            {watch.probes.length === 0 ? (
              <EmptyState
                illustration={<IllustrationServers />}
                title="Nenhuma consulta ainda"
                description="A primeira sai na próxima hora em que o relógio da plataforma passar."
                titleAs="h4"
                layout="row"
                framed={false}
              />
            ) : (
              <Box className="flex flex-col gap-1">
                {watch.probes.slice(0, 12).map((probe) => (
                  <Box key={`${probe.court}:${probe.at}`} className="flex flex-row flex-wrap items-center gap-2">
                    <StatusChip
                      label={OUTCOME[probe.outcome]?.label ?? probe.outcome}
                      tone={OUTCOME[probe.outcome]?.tone ?? "neutral"}
                    />
                    <Typography variant="body2">
                      {`${probe.court} · ${formatDate(probe.at)}${probe.outcome === "ok" ? ` · ${formatNumber(probe.items)} comunicações` : ""}${probe.latencyMs !== null ? ` · ${formatNumber(probe.latencyMs)} ms` : ""}${probe.error ? ` · ${probe.error}` : ""}`}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </>
      ) : null}
    </CollapsibleCard>
  );
}
