"use client";

import AiPricesAdmin from "./ai-prices-admin";
import AutonomyHoldCard from "./autonomy-hold-card";
import DjenHealthCard from "./djen-health-card";
import ExecutorCheckCard from "./executor-check-card";
import FlightReleaseCard from "./flight-release-card";
import ShadowTriageCard from "./shadow-triage-card";
import TaskAutonomyDialog from "./task-autonomy-dialog";
import TaskInstructionsDialog from "./task-instructions-dialog";
import TriagePolicyCard from "./triage-policy-card";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import CollapsibleCard, { CollapsibleGroup, CollapsibleGroupToggle } from "@/components/product/collapsible-card";
import ComparisonTable from "@/components/product/comparison-table";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import InfoHint from "@/components/product/info-hint";
import MetricBars, { type MetricBarItem } from "@/components/product/metric-bars";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiMoney from "@/icons/nexture/ni-money";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiRobot from "@/icons/nexture/ni-robot";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import {
  acceptedShare,
  type AiAccuracy,
  type AiSpendOverview,
  type AiTaskMeasure,
  approversLabel,
  type AutonomyCatalogEntry,
  autonomyLabel,
  decidedCount,
  type DjenHealth,
  EXECUTOR_CHECK_TASK,
  type FirmChoice,
  type FlightWatchStatus,
  formatBrlFromMicros,
  formatUsdMicros,
  type ProviderState,
  providerState,
  spendFirmName,
  type TaskPrompts,
  type TriageMeasure,
} from "@/lib/admin/ai";
import { formatDate, formatNumber, formatPercent } from "@/lib/admin/format";
import type { ConsoleState } from "@/lib/admin/session";

export type AiConsoleState = ConsoleState<{
  spend: AiSpendOverview;
  accuracy: AiAccuracy;
  firms: FirmChoice[];
  /** The instructions of each task: the one in force and how many were published. */
  prompts: TaskPrompts;
  /** How the shadow triage of publications compares with the people's. */
  triage: TriageMeasure;
  /** How the reading of the DJEN is doing across every firm, and whether this environment reads it. */
  djen: DjenHealth;
  /** What ONE decides alone in the firms, and what the operator holds for all of them. */
  autonomy: AutonomyCatalogEntry[];
  flights: FlightWatchStatus;
  flightSourceOn: boolean;
  djenCaptureOn: boolean;
  readiness: { fake: boolean; configured: Record<string, boolean> };
  /** False without SUPABASE_SERVICE_ROLE_KEY: no run can be started from here. */
  serviceAvailable: boolean;
}>;

const CRUMBS = [{ label: "Início", href: "/inicio" }, { label: "Admin", href: "/admin" }, { label: "IA" }];

/** How many firms the cost table shows before the operator asks for the rest. */
const FIRMS_SHOWN = 15;

const PROVIDER_CHIP: Record<ProviderState, { label: string; tone: StatusTone }> = {
  fake: { label: "provedor de teste", tone: "info" },
  ready: { label: "chave configurada", tone: "positive" },
  missing: { label: "sem chave neste ambiente", tone: "attention" },
  none: { label: "sem instruções em vigor", tone: "attention" },
};

const AUTONOMY_TONE: Record<AiTaskMeasure["autonomy"], StatusTone> = {
  approval: "neutral",
  sampled: "info",
  autonomous: "primary",
};

/** A cost in dollars, with the same amount in reais under it when the price list has a rate. */
const costCell = (micros: number, usdToBrl: number | null) => ({
  primary: formatUsdMicros(micros),
  secondary: formatBrlFromMicros(micros, usdToBrl) ?? undefined,
});

/**
 * The operator's view of the platform's use of AI. Three questions bring
 * somebody here: what it is costing and which firm it is costing for; whether
 * the answers of a task are good enough for it to earn autonomy, or whether it
 * is failing; and whether the whole path works for one firm (the check).
 * The price list sits at the end, because every cost above depends on it.
 */
export default function AiConsoleView({ state }: { state: AiConsoleState }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [allFirms, setAllFirms] = useState(false);

  const header = (
    <PageHeader
      title="IA"
      crumbs={CRUMBS}
      description="O que a plataforma pede aos modelos: quanto custa e para qual escritório, como as respostas de cada tarefa se saíram com quem decide, e a tabela de preços por trás de cada custo. Aqui só há contagens e custo: uma resposta pertence ao escritório dela."
      action={
        <Button variant="outlined" color="grey" startIcon={<NiRefresh size="medium" />} onClick={refresh}>
          Atualizar
        </Button>
      }
    />
  );

  if (state.kind !== "ready") {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>{header}</Grid>
        <Grid size={12}>
          {state.kind === "unavailable" ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Este console precisa do Supabase configurado e de uma sessão com o papel de superadmin.
            </Alert>
          ) : (
            // A failed read is an error, never a platform that spent nothing.
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  Tentar de novo
                </Button>
              }
            >
              Não foi possível ler o custo e a medida das tarefas agora. Nada foi alterado.
            </Alert>
          )}
        </Grid>
      </Grid>
    );
  }

  const {
    spend,
    accuracy,
    firms,
    prompts,
    triage,
    djen,
    autonomy,
    flights,
    flightSourceOn,
    djenCaptureOn,
    readiness,
    serviceAvailable,
  } = state;
  const { totals, usdToBrl } = spend;
  const totalBrl = formatBrlFromMicros(totals.costUsdMicros, usdToBrl);
  const checkTask = accuracy.tasks.find((task) => task.task === EXECUTOR_CHECK_TASK) ?? null;
  const taskName = (slug: string) => accuracy.tasks.find((task) => task.task === slug)?.name ?? slug;
  const shownFirms = allFirms ? spend.byFirm : spend.byFirm.slice(0, FIRMS_SHOWN);
  const listedFirms = spend.byFirm.filter((row) => row.orgId !== null).length;

  return (
    // Below the cost, each task and each tool is a card that opens where something went wrong (a run that failed,
    // a reading that is late, a call with no price) and otherwise says in one line how it stands.
    <CollapsibleGroup>
      <Grid container spacing={5}>
        <Grid size={12}>{header}</Grid>

        {readiness.fake ? (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              O provedor de teste está ligado neste ambiente (AI_FAKE_PROVIDER=1): nenhuma chamada sai daqui, e as
              execuções ficam registradas no modelo “fake”, que não tem preço. Em produção a variável é ignorada.
            </Alert>
          </Grid>
        ) : null}

        <Grid size={12}>
          <Box className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile
              icon={<NiMoney size="large" />}
              tone="primary"
              label={`Custo em ${formatNumber(spend.windowDays)} dias`}
              value={formatUsdMicros(totals.costUsdMicros)}
              hint={
                totalBrl
                  ? `${totalBrl} na cotação da tabela de preços`
                  : "Sem cotação na tabela de preços, o custo aparece só em dólar"
              }
            />
            <StatTile
              icon={<NiSparkle size="large" />}
              tone="secondary"
              label="Chamadas aos modelos"
              value={formatNumber(totals.calls)}
              hint="Cada chamada que chegou a um provedor, com ou sem resposta aproveitada"
            />
            <StatTile
              icon={<NiReceipt size="large" />}
              tone={totals.unpricedCalls > 0 ? "accent-3" : "secondary"}
              label="Chamadas sem preço"
              value={formatNumber(totals.unpricedCalls)}
              hint="Chamadas de um modelo que não está na tabela de preços: o custo delas é desconhecido, não zero"
            />
            <StatTile
              icon={<NiBriefcase size="large" />}
              tone="secondary"
              label="Escritórios com custo"
              value={formatNumber(spend.firmsWithSpend)}
              hint="Escritórios para os quais alguma chamada foi feita no período"
            />
          </Box>
        </Grid>

        {totals.unpricedCalls > 0 ? (
          <Grid size={12}>
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {formatNumber(totals.unpricedCalls)}{" "}
              {totals.unpricedCalls === 1 ? "chamada não tem preço" : "chamadas não têm preço"}: o custo acima não as
              inclui. Cadastre o modelo na tabela de preços, no fim desta página, e os lançamentos antigos são
              recalculados.
            </Alert>
          </Grid>
        ) : null}

        {totals.calls === 0 ? (
          <Grid size={12}>
            <EmptyState
              icon={<NiMoney size="large" />}
              title={
                spend.measuringSince
                  ? `Nenhuma chamada nos últimos ${formatNumber(spend.windowDays)} dias`
                  : "Nenhuma chamada de IA até agora"
              }
              description={
                spend.measuringSince
                  ? `A última medição começou em ${formatDate(spend.measuringSince)}. Quando uma tarefa rodar, o custo aparece aqui, por escritório, por tarefa e por modelo.`
                  : "Cada chamada a um modelo é lançada na conta do escritório para o qual foi feita. A verificação do executor é a primeira que você pode rodar: ela mostra o caminho inteiro funcionando."
              }
              action={{ label: "Ir para a verificação", href: "#ai-executor-check" }}
            />
          </Grid>
        ) : (
          <>
            <Grid size={{ xs: 12, lg: 7 }}>
              <Card component="section" aria-labelledby="ai-cost-firms" className="h-full">
                <CardContent className="flex flex-col gap-4">
                  <Box className="flex flex-col gap-1">
                    <Typography id="ai-cost-firms" variant="h5" component="h2" className="mb-0">
                      Custo por escritório
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      Do maior para o menor, nos últimos {formatNumber(spend.windowDays)} dias.
                      {spend.firmsWithSpend > listedFirms
                        ? ` A lista traz os ${formatNumber(listedFirms)} de maior custo, de ${formatNumber(spend.firmsWithSpend)}.`
                        : ""}
                    </Typography>
                  </Box>
                  <ComparisonTable
                    caption="Custo de IA por escritório"
                    rowHeader="Escritório"
                    columns={[
                      { key: "calls", label: "Chamadas" },
                      { key: "unpriced", label: "Sem preço" },
                      { key: "cost", label: "Custo", highlight: true },
                    ]}
                    rows={shownFirms.map((row) => ({
                      key: row.orgId ?? "platform",
                      label: spendFirmName(row),
                      muted: row.orgId === null,
                      cells: [
                        { primary: formatNumber(row.calls) },
                        { primary: formatNumber(row.unpricedCalls) },
                        costCell(row.costUsdMicros, usdToBrl),
                      ],
                    }))}
                    footer={{
                      key: "total",
                      label: "Total do período",
                      cells: [
                        { primary: formatNumber(totals.calls) },
                        { primary: formatNumber(totals.unpricedCalls) },
                        costCell(totals.costUsdMicros, usdToBrl),
                      ],
                    }}
                  />
                  {spend.byFirm.length > FIRMS_SHOWN ? (
                    <Box>
                      <Button variant="text" color="grey" onClick={() => setAllFirms((current) => !current)}>
                        {allFirms
                          ? `Mostrar só os ${FIRMS_SHOWN} primeiros`
                          : `Mostrar os ${formatNumber(spend.byFirm.length)}`}
                      </Button>
                    </Box>
                  ) : null}
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, lg: 5 }}>
              <Card component="section" aria-labelledby="ai-cost-breakdown" className="h-full">
                <CardContent className="flex flex-col gap-5">
                  <Typography id="ai-cost-breakdown" variant="h5" component="h2" className="mb-0">
                    Pelo que o custo foi pago
                  </Typography>
                  <ComparisonTable
                    caption="Custo de IA por tarefa"
                    rowHeader="Tarefa"
                    columns={[
                      { key: "calls", label: "Chamadas" },
                      { key: "cost", label: "Custo", highlight: true },
                    ]}
                    rows={spend.byFeature.map((row) => ({
                      key: row.feature,
                      label: taskName(row.feature),
                      note: taskName(row.feature) === row.feature ? undefined : row.feature,
                      cells: [{ primary: formatNumber(row.calls) }, costCell(row.costUsdMicros, usdToBrl)],
                    }))}
                  />
                  <ComparisonTable
                    caption="Custo de IA por modelo"
                    rowHeader="Modelo"
                    columns={[
                      { key: "calls", label: "Chamadas" },
                      { key: "cost", label: "Custo", highlight: true },
                    ]}
                    rows={spend.byModel.map((row) => ({
                      key: `${row.provider}:${row.model}`,
                      label: row.model,
                      note: row.priced ? row.provider : `${row.provider} · sem preço`,
                      cells: [
                        { primary: formatNumber(row.calls) },
                        row.priced ? costCell(row.costUsdMicros, usdToBrl) : { primary: "sem preço" },
                      ],
                    }))}
                  />
                </CardContent>
              </Card>
            </Grid>
          </>
        )}

        <Grid size={12} className="flex flex-wrap items-end justify-between gap-2">
          <Box className="flex flex-col gap-1">
            <Box className="flex flex-row items-center gap-1">
              <Typography variant="h5" component="h2" className="mb-0">
                Tarefas e a medida de cada uma
              </Typography>
              <InfoHint label="Uma tarefa só deixa de passar pela aprovação de uma pessoa quando a medida mostra que as respostas dela são aceitas como vieram. A mudança é registrada com o motivo." />
            </Box>
            <Typography variant="body1" className="text-text-secondary">
              Execuções e decisões dos últimos {formatNumber(accuracy.windowDays)} dias, somando todos os escritórios.
            </Typography>
          </Box>
          <CollapsibleGroupToggle />
        </Grid>

        {accuracy.tasks.length === 0 ? (
          <Grid size={12}>
            <EmptyState
              icon={<NiRobot size="large" />}
              title="Nenhuma tarefa no catálogo"
              description="As tarefas chegam com as migrações. Sem nenhuma, a plataforma não pede nada a um modelo."
            />
          </Grid>
        ) : (
          accuracy.tasks.map((task) => (
            <Grid key={task.task} size={12}>
              <TaskCard
                task={task}
                provider={providerState(task, readiness)}
                prompts={prompts[task.task] ?? null}
                onChanged={refresh}
              />
            </Grid>
          ))
        )}

        <Grid size={12}>
          <DjenHealthCard health={djen} captureOn={djenCaptureOn} />
        </Grid>
        <Grid size={12}>
          <ShadowTriageCard measure={triage} onChanged={refresh} />
        </Grid>
        <Grid size={12}>
          <AutonomyHoldCard catalog={autonomy} onChanged={refresh} />
        </Grid>
        <Grid size={12}>
          <FlightReleaseCard status={flights} sourceOn={flightSourceOn} onChanged={refresh} />
        </Grid>
        <Grid size={12}>
          <TriagePolicyCard measure={triage} onChanged={refresh} />
        </Grid>

        <Grid size={12}>
          <ExecutorCheckCard
            task={checkTask}
            provider={checkTask ? providerState(checkTask, readiness) : "none"}
            firms={firms}
            serviceAvailable={serviceAvailable}
            onDone={refresh}
          />
        </Grid>

        <Grid size={12}>
          <CollapsibleCard
            id="ai-prices"
            title="Tabela de preços dos modelos"
            summary={
              totals.unpricedCalls > 0
                ? `${formatNumber(totals.unpricedCalls)} ${totals.unpricedCalls === 1 ? "chamada sem preço" : "chamadas sem preço"} no período`
                : "Todas as chamadas do período têm preço"
            }
            chip={totals.unpricedCalls > 0 ? <StatusChip label="Modelo sem preço" tone="attention" /> : null}
            defaultOpen={totals.unpricedCalls > 0}
            bodyClassName="gap-3"
          >
            <AiPricesAdmin onSaved={refresh} />
          </CollapsibleCard>
        </Grid>
      </Grid>
    </CollapsibleGroup>
  );
}

/**
 * One task: what it runs on, how much of what it answers waits for a person,
 * and the two populations the operator judges it by: its runs (did they
 * answer or fail) and its answers (what the people who decide did with them).
 */
function TaskCard({
  task,
  provider,
  prompts,
  onChanged,
}: {
  task: AiTaskMeasure;
  provider: ProviderState;
  prompts: TaskPrompts[string] | null;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<"instructions" | "autonomy" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const decided = decidedCount(task);
  const share = acceptedShare(task);
  const running = Math.max(0, task.runs - task.succeeded - task.failed);
  const chip = PROVIDER_CHIP[provider];

  const runItems: MetricBarItem[] = [
    { key: "succeeded", label: "Responderam", value: task.succeeded, tone: "primary" },
    {
      key: "failed",
      label: "Falharam ou foram recusadas",
      value: task.failed,
      tone: "attention",
      hint: "Provedor fora do ar, resposta cortada ou fora do formato, recusa do modelo, execução abandonada",
    },
    ...(running > 0
      ? [{ key: "running", label: "Em andamento", value: running, tone: "empty" } satisfies MetricBarItem]
      : []),
  ];

  const answerItems: MetricBarItem[] = [
    { key: "approved", label: "Aprovadas como vieram", value: task.approved, tone: "primary" },
    { key: "edited", label: "Aprovadas com correção", value: task.approvedEdited, tone: "secondary" },
    ...(task.revisable
      ? [
          {
            key: "returned",
            label: "Devolvidas com o que mudar",
            value: task.returned ?? 0,
            tone: "secondary",
            hint: "A tarefa respondeu de novo, e essa resposta é contada à parte",
          } satisfies MetricBarItem,
        ]
      : []),
    { key: "rejected", label: "Rejeitadas", value: task.rejected, tone: "attention" },
    { key: "pending", label: "Esperando decisão agora", value: task.pending, tone: "empty" },
  ];

  // Closed, a task says how it ran and how its answers were taken; it opens by itself when some of its runs failed.
  const never = task.runs === 0 && decided + task.pending === 0;
  const summary = never
    ? "Ainda não rodou"
    : [
        `${formatNumber(task.runs)} ${task.runs === 1 ? "execução" : "execuções"}`,
        task.failed > 0 ? `${formatNumber(task.failed)} com falha` : "nenhuma falha",
        task.shadow
          ? "em modo sombra"
          : share === null
            ? "nenhuma resposta decidida"
            : `${formatPercent(share)} aceitas como vieram`,
      ].join(" · ");

  return (
    <CollapsibleCard
      id={`ai-task-${task.task}`}
      titleAs="h3"
      title={task.name}
      chip={
        <>
          <StatusChip label={autonomyLabel(task)} tone={AUTONOMY_TONE[task.autonomy]} />
          <StatusChip label={chip.label} tone={chip.tone} />
        </>
      }
      summary={summary}
      description={[
        task.task,
        task.activeVersion !== null ? `versão ${task.activeVersion} das instruções` : null,
        task.model,
        `decide: ${approversLabel(task.approvers)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      defaultOpen={task.failed > 0}
      bodyClassName="gap-5"
    >
      {never ? (
        <EmptyState
          icon={<NiRobot size="large" />}
          titleAs="h4"
          title="Esta tarefa ainda não rodou"
          description="Quando rodar, aparecem aqui as execuções, as falhas e o que quem decide fez com as respostas."
          action={
            task.task === EXECUTOR_CHECK_TASK
              ? { label: "Ir para a verificação", href: "#ai-executor-check" }
              : undefined
          }
          className="py-8"
        />
      ) : (
        // Open at the page's width, the runs and the answers read side by side.
        <Box className="grid gap-5 lg:grid-cols-2">
          <Box className="flex flex-col gap-3">
            <Typography variant="body2" className="text-text-secondary">
              Execuções no período
            </Typography>
            <MetricBars spacing="dense" total={task.runs} items={runItems} />
          </Box>
          {task.shadow ? (
            <Typography variant="body2" className="text-text-secondary">
              Em modo sombra, nenhuma resposta espera uma pessoa nem tem efeito. A comparação com o que as pessoas
              fizeram está no quadro da triagem em sombra, abaixo.
            </Typography>
          ) : (
            <Box className="flex flex-col gap-3">
              <Typography variant="body2" className="text-text-secondary">
                O que quem decide fez com as respostas
              </Typography>
              <MetricBars spacing="dense" total={decided + task.pending} items={answerItems} />
              <Typography variant="body2" className="text-text-secondary">
                {share === null
                  ? "Ninguém decidiu uma resposta desta tarefa no período: sem decisões não há medida."
                  : `Aceitas como vieram: ${formatPercent(share)} das ${formatNumber(decided)} decididas. É sobre este número que uma tarefa ganha autonomia.`}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      <Box className="border-grey-100 flex flex-col gap-3 border-t pt-4">
        <Typography variant="body2" className="text-text-secondary">
          {prompts?.lastPublishedAt
            ? `${formatNumber(prompts.versions)} ${prompts.versions === 1 ? "versão publicada" : "versões publicadas"}, a última em ${formatDate(prompts.lastPublishedAt)}.`
            : "Nenhuma versão das instruções publicada."}
          {prompts?.active?.note ? ` Nota da versão em vigor: ${prompts.active.note}` : ""}
        </Typography>
        {saved ? (
          <Alert
            severity="success"
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setSaved(null)}
          >
            {saved}
          </Alert>
        ) : null}
        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="outlined" color="grey" size="small" onClick={() => setDialog("instructions")}>
            Nova versão das instruções
          </Button>
          {/* A task in shadow mode acts on nothing, whatever its autonomy says: there is nothing to change here. */}
          {!task.shadow ? (
            <Button variant="text" color="grey" size="small" onClick={() => setDialog("autonomy")}>
              Mudar a autonomia
            </Button>
          ) : null}
        </Box>
      </Box>

      {dialog === "instructions" ? (
        <TaskInstructionsDialog
          task={task}
          active={prompts?.active ?? null}
          onClose={() => setDialog(null)}
          onPublished={(version) => {
            setDialog(null);
            setSaved(`Versão ${formatNumber(version)} publicada e em vigor.`);
            onChanged();
          }}
        />
      ) : null}
      {dialog === "autonomy" ? (
        <TaskAutonomyDialog
          task={task}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setSaved("Autonomia alterada. A mudança ficou no registro de auditoria.");
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}
