"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import FactGrid, { type Fact } from "@/components/product/fact-grid";
import MessageBubble from "@/components/product/message-bubble";
import SectionTitle from "@/components/product/section-title";
import StatusChip from "@/components/product/status-chip";
import type { AreaScript } from "@/lib/areas/script";
import { exampleConversations } from "@/lib/areas/triage-texts";

const CRITERION_TONE = { segue: "positive", nao_atendemos: "neutral", pessoa: "attention" } as const;

/**
 * An area's script as the person reads it before publishing (migration 0273): the kinds of case with their documents
 * and pieces, the triage's questions with the firm's criterion on each option, the stages and the work outside the
 * lawsuit, the firm's words, the courts and the sensitive data. Read only: corrections are made in the editor.
 */
export function AreaScriptReview({ id, script }: { id: string; script: AreaScript }) {
  const t = useTranslations("product");
  const typeName = (key: string) => script.tipos.find((type) => type.chave === key)?.nome ?? key;
  const ofTypes = (keys: string[]) =>
    keys.length === 0 ? t("area-script-every-type") : keys.map(typeName).join(" · ");

  const words: Fact[] = [
    { key: "fees", label: t("area-script-fees"), value: script.honorarios || t("area-script-none-said"), wide: true },
    { key: "doubts", label: t("area-script-doubts"), value: script.duvidas || t("area-script-none-said"), wide: true },
    {
      key: "refusal",
      label: t("area-script-refusal"),
      value: script.recusa || t("area-script-refusal-one"),
      wide: true,
    },
  ];

  return (
    <Box className="flex flex-col gap-5">
      <Box component="section" className="flex flex-col gap-3" aria-labelledby={`${id}-types`}>
        <SectionTitle
          id={`${id}-types`}
          title={t("area-script-types-title")}
          description={t("area-script-types-info")}
          as="h4"
          variant="subtitle2"
        />
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {script.tipos.map((type) => (
            <Box component="li" key={type.chave} className="flex flex-col gap-1">
              <Typography variant="subtitle2" component="span">
                {type.nome}
              </Typography>
              {type.documentos.length > 0 ? (
                <Typography variant="body2" component="span" className="text-text-secondary">
                  {t("area-script-documents-line", {
                    list: type.documentos
                      .map((document) =>
                        document.essencial
                          ? document.nome
                          : t("area-script-document-optional", { name: document.nome }),
                      )
                      .join(" · "),
                  })}
                </Typography>
              ) : null}
              {type.pecas.length > 0 ? (
                <Typography variant="body2" component="span" className="text-text-secondary">
                  {t("area-script-pieces-line", { list: type.pecas.join(" · ") })}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </Box>

      <Box component="section" className="flex flex-col gap-3" aria-labelledby={`${id}-questions`}>
        <SectionTitle
          id={`${id}-questions`}
          title={t("area-script-questions-title")}
          description={t("area-script-questions-info")}
          as="h4"
          variant="subtitle2"
        />
        {script.perguntas.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("area-script-no-questions")}
          </Typography>
        ) : (
          <Box component="ol" className="m-0 flex flex-col gap-3 ps-5">
            {script.perguntas.map((question) => (
              <Box component="li" key={question.chave} className="flex flex-col gap-1">
                <Typography variant="body2" component="span" className="font-medium">
                  {question.texto}
                </Typography>
                {script.tipos.length > 1 ? (
                  <Typography variant="caption" component="span" className="text-text-secondary">
                    {ofTypes(question.tipos)}
                  </Typography>
                ) : null}
                <Box component="ul" className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {question.opcoes.map((option) => (
                    <Box component="li" key={option.chave} className="flex items-center gap-1.5">
                      <Typography variant="body2" component="span">
                        {option.texto}
                      </Typography>
                      <StatusChip
                        label={t(`area-script-criterion-${option.criterio}`)}
                        tone={CRITERION_TONE[option.criterio]}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {script.etapas.length > 0 || script.tarefas.length > 0 ? (
        <Box component="section" className="flex flex-col gap-3" aria-labelledby={`${id}-course`}>
          <SectionTitle
            id={`${id}-course`}
            title={t("area-script-course-title")}
            description={t("area-script-course-info")}
            as="h4"
            variant="subtitle2"
          />
          <Box component="ul" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {script.etapas.map((stage) => (
              <Typography component="li" variant="body2" key={`stage-${stage.chave}`}>
                {t("area-script-stage-line", { name: stage.nome, phase: t(`area-script-phase-${stage.fase}`) })}
              </Typography>
            ))}
            {script.tarefas.map((work) => (
              <Typography component="li" variant="body2" key={`work-${work.chave}`}>
                {t("area-script-work-line", {
                  name: work.nome,
                  who: t(`area-script-worker-${work.quem}`),
                  phase: t(`area-script-phase-${work.fase}`),
                })}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      <Box component="section" className="flex flex-col gap-3" aria-labelledby={`${id}-words`}>
        <SectionTitle
          id={`${id}-words`}
          title={t("area-script-words-title")}
          description={t("area-script-words-info")}
          as="h4"
          variant="subtitle2"
        />
        <FactGrid facts={words} />
      </Box>

      {script.tribunais.length > 0 || script.sensiveis.length > 0 ? (
        <Box component="section" className="flex flex-col gap-3" aria-labelledby={`${id}-courts`}>
          <SectionTitle
            id={`${id}-courts`}
            title={t("area-script-courts-title")}
            description={t("area-script-courts-info")}
            as="h4"
            variant="subtitle2"
          />
          <FactGrid
            facts={[
              ...(script.tribunais.length > 0
                ? [
                    {
                      key: "courts",
                      label: t("area-script-courts"),
                      value: script.tribunais
                        .map((court) => (court.sistema ? `${court.tribunal} (${court.sistema})` : court.tribunal))
                        .join(" · "),
                      wide: true,
                    },
                  ]
                : []),
              ...script.sensiveis.map((data, index) => ({
                key: `sensitive-${index}`,
                label: t(`area-script-sensitive-${data.dado}`),
                value: t("area-script-sensitive-line", { name: data.nome, years: data.guarda_anos }),
                wide: true,
              })),
            ]}
          />
        </Box>
      ) : null}
    </Box>
  );
}

/** The conversations of example, each message the one ONE will send (`exampleConversations`). */
export function AreaScriptExamples({ id, script, areaName }: { id: string; script: AreaScript; areaName: string }) {
  const t = useTranslations("product");
  const examples = exampleConversations(script, areaName);
  return (
    <Box component="section" className="flex flex-col gap-4" aria-labelledby={`${id}-examples`}>
      <SectionTitle
        id={`${id}-examples`}
        title={t("area-script-examples-title")}
        description={t("area-script-examples-info")}
        as="h4"
        variant="subtitle2"
      />
      {examples.map((example) => (
        <Box key={example.titulo} className="flex flex-col gap-2">
          <Typography variant="body2" className="font-medium">
            {example.titulo}
          </Typography>
          <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
            {example.mensagens.map((message, index) => (
              <MessageBubble
                key={index}
                side={message.quem === "one" ? "out" : "in"}
                sideLabel={message.quem === "one" ? t("area-script-example-one") : t("area-script-example-client")}
              >
                <Box component="span" className="whitespace-pre-line">
                  {message.texto}
                </Box>
              </MessageBubble>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
