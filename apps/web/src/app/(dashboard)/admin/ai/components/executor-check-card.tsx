"use client";

import { runExecutorCheck } from "../actions";
import { useState } from "react";

import { Alert, Autocomplete, Box, Button, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import NiPlay from "@/icons/nexture/ni-play";
import {
  type AiTaskMeasure,
  approversLabel,
  autonomyLabel,
  FIRM_CHOICE_LIMIT,
  type FirmChoice,
  formatUsdMicros,
  type ProviderState,
} from "@/lib/admin/ai";

/** What each answer of the executor means, in the operator's words. Codes come from `runAiTask` and the run store. */
const FAILURE: Record<string, string> = {
  forbidden: "Só quem tem o papel de superadmin roda a verificação, e nunca de dentro de uma sessão de suporte.",
  invalid: "Escolha um escritório da lista.",
  reason_required: "Diga por que a verificação está sendo rodada (no mínimo 8 caracteres).",
  backend_not_configured:
    "Sem SUPABASE_SERVICE_ROLE_KEY neste ambiente: só o backend inicia uma execução. Nada foi registrado.",
  store_unavailable:
    "O banco não respondeu ao abrir ou fechar a execução. Se ela ficou aberta, a varredura a encerra como abandonada em até meia hora.",
  firm_not_found: "Este escritório não existe mais. Recarregue a página.",
  unknown_task: "A tarefa de verificação não está ativa.",
  no_prompt_version: "A tarefa não tem instruções em vigor: nenhuma versão está publicada.",
  invalid_prompt_version: "As instruções em vigor nomeiam um provedor que este código não conhece.",
  provider_not_configured:
    "O provedor desta tarefa não tem chave neste ambiente. A execução ficou registrada como falha, sem custo.",
  provider_cannot_read_documents:
    "As instruções em vigor nomeiam um provedor que não recebe PDF, e a tarefa leva um documento. A execução ficou registrada como falha, sem custo.",
  provider_unavailable:
    "O provedor não respondeu (instabilidade ou limite de uso). A execução ficou registrada como falha. Tente de novo em instantes.",
  provider_rejected:
    "O provedor recusou a chamada: chave inválida, modelo que não existe ou parâmetro que ele não aceita. A execução ficou registrada como falha.",
  provider_blocked: "O modelo se recusou a responder. A execução ficou registrada como bloqueada.",
  output_truncated:
    "A resposta foi cortada no limite de tokens da versão em vigor. A execução ficou registrada como falha, com o custo do que foi gasto.",
  output_empty: "O modelo respondeu vazio. A execução ficou registrada como falha.",
  output_invalid_json: "O modelo não respondeu no formato pedido. A execução ficou registrada como falha.",
  output_not_an_object: "O modelo não respondeu no formato pedido. A execução ficou registrada como falha.",
  output_incomplete:
    "A resposta veio sem um campo que as instruções pedem. A execução ficou registrada como falha, com o custo.",
  run_already_closed:
    "A execução demorou mais do que o limite e foi encerrada como abandonada antes de a resposta chegar. A resposta foi descartada.",
};

const failureText = (code: string) =>
  FAILURE[code] ?? `A verificação não terminou (${code}). Veja o registro da execução.`;

type Outcome = { tone: "success" | "error"; text: string } | null;

/**
 * Runs the task that has nothing of a client in it for one firm, so the whole
 * path is seen working there: the instructions in force, the model, the cost
 * charged to the firm, and the answer in the firm's queue, where one of its
 * lawyers decides it. The operator sees that it ran and what it cost, never
 * the answer.
 */
export default function ExecutorCheckCard({
  task,
  provider,
  firms,
  serviceAvailable,
  onDone,
}: {
  /** The verification task as the measure describes it; null when it is not in the catalog. */
  task: AiTaskMeasure | null;
  provider: ProviderState;
  firms: FirmChoice[];
  serviceAvailable: boolean;
  onDone: () => void;
}) {
  const [firm, setFirm] = useState<FirmChoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const blocked = !serviceAvailable
    ? "Sem SUPABASE_SERVICE_ROLE_KEY neste ambiente, nenhuma execução pode ser iniciada."
    : !task || task.activeVersion === null
      ? "A tarefa de verificação não tem instruções em vigor."
      : null;

  const model = task?.model ?? "o modelo da versão em vigor";
  const waits = task ? task.autonomy !== "autonomous" : true;

  const run = async (reason: string): Promise<string | null> => {
    if (!firm) return FAILURE.invalid;
    const result = await runExecutorCheck(firm.id, reason);
    if (!result.ok) {
      // A run that started and failed is a result worth keeping on the screen;
      // a refusal before anything started stays in the dialog.
      if (result.runId) {
        setOutcome({ tone: "error", text: failureText(result.code) });
        onDone();
        return null;
      }
      return failureText(result.code);
    }
    const cost = result.priced
      ? `custo de ${formatUsdMicros(result.costUsdMicros)}`
      : "custo sem preço: o modelo que respondeu não está na tabela de preços";
    setOutcome({
      tone: "success",
      text:
        result.outcome === "queued"
          ? `Execução registrada em ${firm.name}, ${cost}. A resposta está na fila de aprovações do escritório, esperando alguém de lá decidir.`
          : `Execução registrada em ${firm.name}, ${cost}. A tarefa age sozinha, então nada entrou na fila do escritório.`,
    });
    onDone();
    return null;
  };

  return (
    <CollapsibleCard
      id="ai-executor-check"
      title="Verificação do executor"
      summary={
        blocked ??
        (provider === "missing"
          ? "O provedor desta tarefa não tem chave neste ambiente"
          : `Pergunta fixa a ${model}, em nome de um escritório`)
      }
      description="Faz uma pergunta fixa ao modelo, sem dado de cliente, em nome de um escritório, para ver o caminho inteiro: as instruções em vigor, a chamada, o custo na conta dele e a resposta na fila."
    >
      {blocked ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {blocked}
        </Alert>
      ) : null}

      {provider === "missing" ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          O provedor desta tarefa ({task?.provider}) não tem chave neste ambiente. A verificação pode ser rodada, e vai
          ficar registrada como falha, sem custo.
        </Alert>
      ) : null}

      <Box className="flex flex-col gap-3 md:flex-row md:items-start">
        <Autocomplete
          className="md:min-w-96"
          options={firms}
          value={firm}
          onChange={(_, value) => {
            setFirm(value);
            setOutcome(null);
          }}
          getOptionLabel={(option) => option.name}
          getOptionKey={(option) => option.id}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          noOptionsText="Nenhum escritório com este nome"
          disabled={Boolean(blocked)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Escritório"
              size="small"
              helperText={
                firms.length >= FIRM_CHOICE_LIMIT
                  ? `A lista mostra os primeiros ${FIRM_CHOICE_LIMIT} escritórios em ordem alfabética.`
                  : undefined
              }
            />
          )}
        />
        <Button
          variant="contained"
          startIcon={<NiPlay size="medium" />}
          disabled={Boolean(blocked) || !firm}
          onClick={() => setConfirming(true)}
          className="flex-none"
        >
          Rodar a verificação
        </Button>
      </Box>

      {firms.length === 0 && !blocked ? (
        <Typography variant="body2" className="text-text-secondary">
          Nenhum escritório foi fundado ainda. A verificação precisa de um para lançar o custo e receber a resposta.
        </Typography>
      ) : null}

      {outcome ? (
        <Alert severity={outcome.tone} className="neutral bg-background-paper/60!" role="status">
          {outcome.text}
        </Alert>
      ) : null}

      {confirming && firm ? (
        <ConfirmActionDialog
          key={firm.id}
          title={`Rodar a verificação em ${firm.name}`}
          intro="A verificação é uma execução de verdade, registrada no escritório como qualquer outra."
          consequences={[
            provider === "fake"
              ? "Responde com o provedor de teste deste ambiente: nenhuma chamada sai daqui."
              : `Faz uma chamada a ${model} com a pergunta fixa da tarefa.`,
            "Lança o custo da chamada na conta de IA deste escritório.",
            waits
              ? `Coloca a resposta na fila de aprovações do escritório, onde decide quem tem a função de ${task ? approversLabel(task.approvers) : "quem a tarefa nomeia"}.`
              : `Não passa pela fila do escritório: hoje esta tarefa ${task ? autonomyLabel(task) : "age sozinha"}.`,
            "Fica na trilha de auditoria do escritório, com o seu nome e o motivo.",
          ]}
          stays={[
            "Você não vê a resposta: ela pertence ao escritório.",
            "Nenhum dado de cliente entra na pergunta.",
            "Nada muda no escritório enquanto ninguém de lá decidir.",
          ]}
          reasonPlaceholder="Ex.: conferindo a fila antes de liberar a triagem de documentos"
          confirmLabel="Rodar a verificação"
          busyLabel="Rodando…"
          onConfirm={run}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </CollapsibleCard>
  );
}
