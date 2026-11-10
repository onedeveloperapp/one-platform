"use client";

import { reopenPublicationTriage } from "../actions";
import { useState, useTransition } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ComparisonTable from "@/components/product/comparison-table";
import EmptyState from "@/components/product/empty-state";
import InfoHint from "@/components/product/info-hint";
import MetricBars from "@/components/product/metric-bars";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import { TRIAGE_CATEGORY_LABEL, type TriageMeasure } from "@/lib/admin/ai";
import { formatNumber, formatPercent, ratio } from "@/lib/admin/format";

/**
 * The shadow triage of publications, compared with the people's: of the
 * publications both classified, how often the AI said what the person said.
 * The operator comes here to decide whether the task may one day do more
 * than watch, so the answer leads (the share that agreed) and the categories
 * follow, because a task that is right about a notice and wrong about a
 * deadline is not right.
 *
 * Every number is of the publications captured in the same window, so each
 * is a part of the one before it. Counts only: a publication belongs to its
 * firm. Closest existing shape: the task cards of this console (`MetricBars`
 * for one population) and its cost tables (`ComparisonTable` for rows that
 * are compared).
 */
export default function ShadowTriageCard({ measure, onChanged }: { measure: TriageMeasure; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const share = ratio(measure.agreed, measure.compared);
  const waiting = Math.max(measure.captured - measure.classifiedByAi - measure.gaveUp, 0);

  const reopen = () =>
    startTransition(async () => {
      try {
        const result = await reopenPublicationTriage();
        if (!result.ok) {
          setNotice({ tone: "error", text: "Não foi possível devolver as publicações à fila agora." });
          return;
        }
        setNotice({
          tone: "success",
          text: `${formatNumber(result.reopened)} ${result.reopened === 1 ? "publicação voltou" : "publicações voltaram"} para a fila da triagem em sombra. Ficou no registro de auditoria.`,
        });
        onChanged();
      } catch {
        setNotice({ tone: "error", text: "Não foi possível devolver as publicações à fila agora." });
      }
    });

  return (
    <CollapsibleCard
      id="ai-shadow-triage"
      title="Triagem de publicações em modo sombra"
      chip={
        <InfoHint label="A IA classifica cada publicação do DJEN, e a resposta fica guardada sem aparecer ao escritório nem decidir nada. Aqui ela é comparada com o que uma pessoa disse da mesma publicação." />
      }
      summary={
        measure.captured === 0
          ? "Nenhuma publicação capturada no período"
          : measure.compared === 0
            ? `${formatNumber(measure.captured)} ${measure.captured === 1 ? "publicação capturada" : "publicações capturadas"}, nenhuma comparada ainda`
            : `${formatNumber(measure.compared)} ${measure.compared === 1 ? "comparada" : "comparadas"} com a triagem das pessoas · ${formatPercent(share)} de concordância`
      }
      description={`Publicações capturadas nos últimos ${formatNumber(measure.windowDays)} dias, somando todos os escritórios.`}
      bodyClassName="gap-5"
    >
      {notice ? (
        <Alert
          severity={notice.tone}
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      ) : null}

      {measure.captured === 0 ? (
        <EmptyState
          titleAs="h3"
          illustration={<IllustrationEmail />}
          title="Nenhuma publicação capturada no período"
          description="Quando a leitura do DJEN trouxer publicações, a classificação da IA e a comparação com a triagem das pessoas aparecem aqui."
          className="py-8"
        />
      ) : (
        <>
          <Box className="flex flex-col gap-3">
            <Typography variant="body2" className="text-text-secondary">
              O que a IA fez das {formatNumber(measure.captured)} publicações capturadas
            </Typography>
            <MetricBars
              spacing="dense"
              total={measure.captured}
              items={[
                { key: "classified", label: "Classificou", value: measure.classifiedByAi, tone: "primary" },
                {
                  key: "waiting",
                  label: "Ainda não classificou",
                  value: waiting,
                  tone: "empty",
                  hint: "Na fila, ou canceladas pelo tribunal antes da vez delas",
                },
                {
                  key: "gave-up",
                  label: "Desistiu",
                  value: measure.gaveUp,
                  tone: "attention",
                  hint: "A resposta veio fora do formato, cortada ou recusada, mais de uma vez",
                  action:
                    measure.gaveUp > 0 ? (
                      <Button variant="outlined" color="grey" size="small" onClick={reopen} disabled={pending}>
                        Devolver à fila
                      </Button>
                    ) : undefined,
                },
              ]}
            />
          </Box>

          {measure.compared === 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma publicação foi classificada pela IA e triada por uma pessoa ainda: sem comparação não há medida.
            </Typography>
          ) : (
            <>
              <Box className="flex flex-col gap-3">
                <Typography variant="body2" className="text-text-secondary">
                  Das {formatNumber(measure.compared)} que uma pessoa também triou
                </Typography>
                <MetricBars
                  spacing="dense"
                  total={measure.compared}
                  items={[
                    {
                      key: "agreed",
                      label: "A IA disse o mesmo que a pessoa",
                      value: measure.agreed,
                      tone: "primary",
                    },
                    {
                      key: "differed",
                      label: "A IA disse outra coisa",
                      value: measure.compared - measure.agreed,
                      tone: "attention",
                    },
                  ]}
                />
              </Box>
              <ComparisonTable
                caption="Concordância da triagem em sombra por categoria"
                rowHeader="O que a pessoa disse"
                columns={[
                  { key: "compared", label: "Comparadas" },
                  { key: "agreed", label: "A IA disse o mesmo" },
                  { key: "share", label: "Concordância", highlight: true },
                ]}
                rows={measure.byCategory.map((row) => ({
                  key: row.category,
                  label: TRIAGE_CATEGORY_LABEL[row.category] ?? row.category,
                  cells: [
                    { primary: formatNumber(row.compared) },
                    { primary: formatNumber(row.agreed) },
                    { primary: formatPercent(ratio(row.agreed, row.compared)) },
                  ],
                }))}
                footer={{
                  key: "total",
                  label: "Todas",
                  cells: [
                    { primary: formatNumber(measure.compared) },
                    { primary: formatNumber(measure.agreed) },
                    { primary: formatPercent(share) },
                  ],
                }}
              />
              <Typography variant="body2" className="text-text-secondary mt-auto">
                A triagem só deixa de ser sombra por decisão registrada, e a concordância em prazo é a que mais pesa: um
                prazo que a IA chama de ciência é um prazo perdido.
              </Typography>
            </>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
