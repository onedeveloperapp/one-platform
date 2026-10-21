"use client";

import { Alert, Box, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import InfoHint from "@/components/product/info-hint";
import MetricBars from "@/components/product/metric-bars";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { DJEN_FAILURE_LABEL, type DjenHealth } from "@/lib/admin/ai";
import { formatDate, formatNumber } from "@/lib/admin/format";

/**
 * How the reading of the DJEN is doing across every firm. The operator
 * comes here to know whether some firm may be missing what the courts told
 * it: a reading that is late or keeps failing shows nowhere else outside the
 * firm it belongs to. So the answer leads (how many registrations are read
 * in time, how many are not) and the reasons follow.
 *
 * Counts only: a registration and a publication belong to their firm.
 * Closest existing shape: the task cards of this console (`MetricBars` for
 * one population split by what became of it).
 */
export default function DjenHealthCard({ health, captureOn }: { health: DjenHealth; captureOn: boolean }) {
  const failing = health.failing.reduce((sum, row) => sum + row.registrations, 0);
  return (
    <Card component="section" aria-labelledby="ai-djen-health" className="h-full">
      <CardContent className="flex h-full flex-col gap-5">
        <Box className="flex flex-col gap-1">
          <Box className="flex flex-row items-center gap-1">
            <Typography id="ai-djen-health" variant="h5" component="h2" className="mb-0">
              Leitura do DJEN
            </Typography>
            <InfoHint label="Cada inscrição na OAB de alguém de um escritório é lida no DJEN algumas vezes por dia. Uma leitura atrasada ou que falha pode ser um escritório sem as publicações dele, e só aqui isso aparece fora do escritório." />
          </Box>
          <Typography variant="body1" className="text-text-secondary">
            Todas as inscrições lidas, somando todos os escritórios.
          </Typography>
        </Box>

        {!captureOn ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            Este ambiente não lê o DJEN (DJEN_CAPTURE). As inscrições abaixo aparecem como atrasadas por isso.
          </Alert>
        ) : null}

        {/* What the readings themselves cannot say: a sweep that is not running leaves no reading behind. */}
        {health.unseen > 0 ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {formatNumber(health.unseen)}{" "}
            {health.unseen === 1
              ? "inscrição de alguém de um escritório ainda não foi vista por nenhuma varredura"
              : "inscrições de pessoas de escritórios ainda não foram vistas por nenhuma varredura"}
            {health.unseenSince ? `, a mais antiga desde ${formatDate(health.unseenSince)}` : ""}. A varredura passa a
            cada cinco minutos: se isso não some, o job da leitura não está rodando.
          </Alert>
        ) : null}

        {health.registrations === 0 ? (
          <EmptyState
            icon={<NiRefresh size="large" />}
            title={health.unseen > 0 ? "Nenhuma leitura feita ainda" : "Nenhuma inscrição para ler"}
            description={
              health.unseen > 0
                ? "Há inscrições cadastradas, e nenhuma varredura passou por elas."
                : "Quando alguém de um escritório cadastrar a inscrição na OAB, a leitura dela aparece aqui."
            }
            className="py-8"
          />
        ) : (
          <>
            <Box className="flex flex-col gap-3">
              <Typography variant="body2" className="text-text-secondary">
                Das {formatNumber(health.registrations)} inscrições, de {formatNumber(health.firms)}{" "}
                {health.firms === 1 ? "escritório" : "escritórios"}
              </Typography>
              <MetricBars
                spacing="dense"
                total={health.registrations}
                items={[
                  { key: "in-time", label: "Lidas em dia", value: health.inTime, tone: "primary" },
                  {
                    key: "late",
                    label: `Sem leitura há mais de ${formatNumber(health.lateHours)} horas`,
                    value: health.late,
                    tone: "attention",
                    hint:
                      health.firmsLate > 0
                        ? `Em ${formatNumber(health.firmsLate)} ${health.firmsLate === 1 ? "escritório" : "escritórios"}, que é avisado no início dele`
                        : undefined,
                  },
                  {
                    key: "waiting-first",
                    label: "Esperando a primeira leitura",
                    value: health.waitingFirst,
                    tone: "secondary",
                  },
                ]}
              />
              {health.neverRead > health.waitingFirst ? (
                <Typography variant="body2" className="text-text-secondary">
                  Das atrasadas, {formatNumber(health.neverRead - health.waitingFirst)}{" "}
                  {health.neverRead - health.waitingFirst === 1 ? "nunca foi lida" : "nunca foram lidas"}.
                </Typography>
              ) : null}
            </Box>

            {health.failing.length > 0 ? (
              <Box className="flex flex-col gap-3">
                <Typography variant="body2" className="text-text-secondary">
                  Por que a última leitura falhou
                </Typography>
                <MetricBars
                  spacing="dense"
                  total={failing}
                  items={health.failing.slice(0, 6).map((row) => ({
                    key: row.code,
                    label: DJEN_FAILURE_LABEL[row.code] ?? row.code,
                    value: row.registrations,
                    tone: "attention" as const,
                  }))}
                />
              </Box>
            ) : null}

            {health.leftOut > 0 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {formatNumber(health.leftOut)}{" "}
                {health.leftOut === 1
                  ? "comunicação veio do DJEN em um formato que não pôde ser guardado"
                  : "comunicações vieram do DJEN em um formato que não pôde ser guardado"}{" "}
                nos últimos dias, em {formatNumber(health.incomplete)}{" "}
                {health.incomplete === 1 ? "inscrição" : "inscrições"}. O escritório é avisado no início e na tela de
                publicações; o formato pode ter mudado na API.
              </Alert>
            ) : null}

            {health.stopped > 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                {formatNumber(health.stopped)}{" "}
                {health.stopped === 1
                  ? "leitura parou porque ninguém do escritório tem mais a inscrição"
                  : "leituras pararam porque ninguém do escritório tem mais a inscrição"}
                . O escritório é avisado quando a pessoa ainda consta em processos dele.
              </Typography>
            ) : null}

            <Typography variant="body2" className="text-text-secondary mt-auto">
              {formatNumber(health.capturedLastDay)}{" "}
              {health.capturedLastDay === 1 ? "publicação capturada" : "publicações capturadas"} nas últimas 24 horas
              {health.oldestReadAt ? ` · leitura mais antiga em ${formatDate(health.oldestReadAt)}` : ""}
              {health.reading > 0 ? ` · ${formatNumber(health.reading)} em leitura agora` : ""}.
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}
