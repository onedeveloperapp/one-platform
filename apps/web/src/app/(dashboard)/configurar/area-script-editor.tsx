"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import SectionTitle from "@/components/product/section-title";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiPlus from "@/icons/nexture/ni-plus";
import {
  type AreaScript,
  SCRIPT_DOCUMENT_KINDS,
  SCRIPT_LIMITS,
  SCRIPT_PHASES,
  SCRIPT_WORKERS,
  SENSITIVE_DATA,
} from "@/lib/areas/script";
import { saveAreaScriptDraft } from "@/lib/areas/script-actions";

/** A key for an item the person adds: stable while they rename it, so what names it keeps naming it. */
const newKey = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const field = { variant: "standard" as const, className: "outlined", size: "small" as const };

/**
 * The person's correction of an area's draft (migration 0273), in a panel beside the step: every part of the script
 * ONE wrote, each list with "Incluir" at its foot and the bin at each item. Saved whole, within the rules for
 * everybody, which the database checks again; a refusal says why and keeps what was typed.
 */
export function AreaScriptEditor({
  open,
  areaName,
  scriptId,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  areaName: string;
  scriptId: string;
  initial: AreaScript;
  onClose: () => void;
  onSaved: (script: AreaScript) => void;
}) {
  const t = useTranslations("product");
  const [script, setScript] = useState<AreaScript>(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (update: (draft: AreaScript) => void) =>
    setScript((current) => {
      const next = structuredClone(current);
      update(next);
      return next;
    });

  const save = async () => {
    setError(null);
    setBusy(true);
    const done = await saveAreaScriptDraft({ scriptId, script }).catch(() => ({ ok: false as const, code: "failed" }));
    setBusy(false);
    if (!done.ok) {
      setError(
        done.code === "copy_rules"
          ? t("area-script-error-copy_rules")
          : done.code === "promise"
            ? t("area-script-error-promise")
            : done.code === "shape"
              ? t("area-script-error-shape")
              : done.code === "second_factor_required"
                ? t("setup-operation-error-second_factor")
                : t("setup-operation-error-failed"),
      );
      return;
    }
    onSaved(script);
  };

  const remove = (label: string, onClick: () => void) => (
    <IconButton size="small" aria-label={label} onClick={onClick} disabled={busy}>
      <NiBinEmpty size="small" />
    </IconButton>
  );
  const add = (label: string, onClick: () => void, disabled = false) => (
    <Box>
      <Button
        variant="text"
        size="small"
        startIcon={<NiPlus size="small" />}
        onClick={onClick}
        disabled={busy || disabled}
      >
        {label}
      </Button>
    </Box>
  );
  const typeOptions = script.tipos.map((type) => ({
    key: type.chave,
    label: type.nome || t("area-script-type-unnamed"),
  }));
  const typesPicker = (id: string, value: string[], onChange: (keys: string[]) => void) =>
    script.tipos.length > 1 ? (
      <Autocomplete
        multiple
        id={id}
        size="small"
        options={typeOptions}
        value={typeOptions.filter((option) => value.includes(option.key))}
        onChange={(_, chosen) => onChange(chosen.map((option) => option.key))}
        getOptionLabel={(option) => option.label}
        isOptionEqualToValue={(option, other) => option.key === other.key}
        disabled={busy}
        renderInput={(params) => (
          <TextField
            {...params}
            {...field}
            label={t("area-script-edit-types-of")}
            helperText={t("area-script-edit-types-of-help")}
          />
        )}
      />
    ) : null;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      closeLabel={t("area-script-edit-close")}
      title={t("area-script-edit-title", { area: areaName })}
      description={t("area-script-edit-description")}
      icon={<NiListCheck size="medium" />}
      busy={busy}
      wide
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("area-script-edit-save")}
          </Button>
          <Button variant="text" onClick={onClose} disabled={busy}>
            {t("setup-personality-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-6">
        {/* The kinds of case, with their documents and pieces. */}
        <Box component="section" className="flex flex-col gap-4" aria-labelledby="area-edit-types">
          <SectionTitle id="area-edit-types" title={t("area-script-types-title")} as="h3" variant="subtitle1" />
          {script.tipos.map((type, typeIndex) => (
            <Box key={type.chave} className="flex flex-col gap-3">
              <Box className="flex items-end gap-2">
                <TextField
                  {...field}
                  fullWidth
                  id={`area-edit-type-${type.chave}`}
                  label={t("area-script-edit-type-name")}
                  value={type.nome}
                  onChange={(event) => change((draft) => void (draft.tipos[typeIndex]!.nome = event.target.value))}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                />
                {script.tipos.length > 1
                  ? remove(t("area-script-edit-remove-type", { name: type.nome }), () =>
                      change((draft) => {
                        draft.tipos.splice(typeIndex, 1);
                        for (const question of draft.perguntas)
                          question.tipos = question.tipos.filter((key) => key !== type.chave);
                        for (const work of draft.tarefas) work.tipos = work.tipos.filter((key) => key !== type.chave);
                      }),
                    )
                  : null}
              </Box>
              <Box className="flex flex-col gap-2 ps-4">
                <Typography variant="caption" className="text-text-secondary">
                  {t("area-script-edit-documents")}
                </Typography>
                {type.documentos.map((document, documentIndex) => (
                  <Box key={document.chave} className="flex flex-wrap items-end gap-2">
                    <TextField
                      {...field}
                      className="outlined min-w-48 flex-1"
                      id={`area-edit-doc-${type.chave}-${document.chave}`}
                      label={t("area-script-edit-document-name")}
                      value={document.nome}
                      onChange={(event) =>
                        change(
                          (draft) =>
                            void (draft.tipos[typeIndex]!.documentos[documentIndex]!.nome = event.target.value),
                        )
                      }
                      disabled={busy}
                      slotProps={{ htmlInput: { maxLength: 120 } }}
                    />
                    <TextField
                      {...field}
                      select
                      className="outlined w-44"
                      id={`area-edit-doc-kind-${type.chave}-${document.chave}`}
                      label={t("area-script-edit-document-kind")}
                      value={document.tipo}
                      onChange={(event) =>
                        change(
                          (draft) =>
                            void (draft.tipos[typeIndex]!.documentos[documentIndex]!.tipo = event.target
                              .value as (typeof SCRIPT_DOCUMENT_KINDS)[number]),
                        )
                      }
                      disabled={busy}
                    >
                      {SCRIPT_DOCUMENT_KINDS.map((kind) => (
                        <MenuItem key={kind} value={kind}>
                          {t(`area-script-kind-${kind}`)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      {...field}
                      select
                      className="outlined w-36"
                      id={`area-edit-doc-per-${type.chave}-${document.chave}`}
                      label={t("area-script-edit-document-per")}
                      value={document.por}
                      onChange={(event) =>
                        change(
                          (draft) =>
                            void (draft.tipos[typeIndex]!.documentos[documentIndex]!.por = event.target.value as
                              | "caso"
                              | "pessoa"),
                        )
                      }
                      disabled={busy}
                    >
                      <MenuItem value="caso">{t("area-script-per-caso")}</MenuItem>
                      <MenuItem value="pessoa">{t("area-script-per-pessoa")}</MenuItem>
                    </TextField>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={document.essencial}
                          onChange={(event) =>
                            change(
                              (draft) =>
                                void (draft.tipos[typeIndex]!.documentos[documentIndex]!.essencial =
                                  event.target.checked),
                            )
                          }
                          disabled={busy}
                        />
                      }
                      label={t("area-script-edit-document-essential")}
                    />
                    {remove(t("area-script-edit-remove-document", { name: document.nome }), () =>
                      change((draft) => void draft.tipos[typeIndex]!.documentos.splice(documentIndex, 1)),
                    )}
                  </Box>
                ))}
                {add(
                  t("area-script-edit-add-document"),
                  () =>
                    change(
                      (draft) =>
                        void draft.tipos[typeIndex]!.documentos.push({
                          chave: newKey("doc"),
                          nome: "",
                          tipo: "other",
                          por: "caso",
                          essencial: true,
                        }),
                    ),
                  type.documentos.length >= SCRIPT_LIMITS.documents,
                )}
                <Autocomplete
                  multiple
                  freeSolo
                  id={`area-edit-pieces-${type.chave}`}
                  size="small"
                  options={[] as string[]}
                  value={type.pecas}
                  onChange={(_, pieces) =>
                    change(
                      (draft) =>
                        void (draft.tipos[typeIndex]!.pecas = pieces
                          .map((piece) => String(piece).trim())
                          .filter(Boolean)
                          .slice(0, SCRIPT_LIMITS.pieces)),
                    )
                  }
                  disabled={busy}
                  renderValue={(values, getItemProps) =>
                    values.map((value, index) => {
                      const { key, ...props } = getItemProps({ index });
                      return <Chip key={key} size="small" label={value} {...props} />;
                    })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      {...field}
                      label={t("area-script-edit-pieces")}
                      helperText={t("area-script-edit-pieces-help")}
                    />
                  )}
                />
              </Box>
            </Box>
          ))}
          {add(
            t("area-script-edit-add-type"),
            () =>
              change((draft) => void draft.tipos.push({ chave: newKey("tipo"), nome: "", documentos: [], pecas: [] })),
            script.tipos.length >= SCRIPT_LIMITS.types,
          )}
        </Box>

        {/* The questions of the triage, each option with the firm's criterion. */}
        <Box component="section" className="flex flex-col gap-4" aria-labelledby="area-edit-questions">
          <SectionTitle
            id="area-edit-questions"
            title={t("area-script-questions-title")}
            description={t("area-script-questions-info")}
            as="h3"
            variant="subtitle1"
          />
          {script.perguntas.map((question, questionIndex) => (
            <Box key={question.chave} className="flex flex-col gap-2">
              <Box className="flex items-end gap-2">
                <TextField
                  {...field}
                  fullWidth
                  id={`area-edit-question-${question.chave}`}
                  label={t("area-script-edit-question", { n: questionIndex + 1 })}
                  value={question.texto}
                  onChange={(event) =>
                    change((draft) => void (draft.perguntas[questionIndex]!.texto = event.target.value))
                  }
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 300 } }}
                />
                {remove(t("area-script-edit-remove-question", { n: questionIndex + 1 }), () =>
                  change((draft) => void draft.perguntas.splice(questionIndex, 1)),
                )}
              </Box>
              {typesPicker(`area-edit-question-types-${question.chave}`, question.tipos, (keys) =>
                change((draft) => void (draft.perguntas[questionIndex]!.tipos = keys)),
              )}
              <Box className="flex flex-col gap-2 ps-4">
                {question.opcoes.map((option, optionIndex) => (
                  <Box key={option.chave} className="flex flex-wrap items-end gap-2">
                    <TextField
                      {...field}
                      className="outlined min-w-40 flex-1"
                      id={`area-edit-option-${question.chave}-${option.chave}`}
                      label={t("area-script-edit-option", { n: optionIndex + 1 })}
                      value={option.texto}
                      onChange={(event) =>
                        change(
                          (draft) =>
                            void (draft.perguntas[questionIndex]!.opcoes[optionIndex]!.texto = event.target.value),
                        )
                      }
                      disabled={busy}
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                    <TextField
                      {...field}
                      select
                      className="outlined w-48"
                      id={`area-edit-criterion-${question.chave}-${option.chave}`}
                      label={t("area-script-edit-criterion")}
                      value={option.criterio}
                      onChange={(event) =>
                        change(
                          (draft) =>
                            void (draft.perguntas[questionIndex]!.opcoes[optionIndex]!.criterio = event.target.value as
                              | "segue"
                              | "nao_atendemos"
                              | "pessoa"),
                        )
                      }
                      disabled={busy}
                    >
                      <MenuItem value="segue">{t("area-script-criterion-segue")}</MenuItem>
                      <MenuItem value="nao_atendemos">{t("area-script-criterion-nao_atendemos")}</MenuItem>
                      <MenuItem value="pessoa">{t("area-script-criterion-pessoa")}</MenuItem>
                    </TextField>
                    {question.opcoes.length > 2
                      ? remove(t("area-script-edit-remove-option", { n: optionIndex + 1 }), () =>
                          change((draft) => void draft.perguntas[questionIndex]!.opcoes.splice(optionIndex, 1)),
                        )
                      : null}
                  </Box>
                ))}
                {add(
                  t("area-script-edit-add-option"),
                  () =>
                    change(
                      (draft) =>
                        void draft.perguntas[questionIndex]!.opcoes.push({
                          chave: newKey("op"),
                          texto: "",
                          criterio: "pessoa",
                        }),
                    ),
                  question.opcoes.length >= SCRIPT_LIMITS.options,
                )}
              </Box>
            </Box>
          ))}
          {add(
            t("area-script-edit-add-question"),
            () =>
              change(
                (draft) =>
                  void draft.perguntas.push({
                    chave: newKey("pergunta"),
                    texto: "",
                    tipos: [],
                    opcoes: [
                      { chave: "sim", texto: t("area-script-edit-yes"), criterio: "segue" },
                      { chave: "nao", texto: t("area-script-edit-no"), criterio: "pessoa" },
                    ],
                  }),
              ),
            script.perguntas.length >= SCRIPT_LIMITS.questions,
          )}
        </Box>

        {/* The stages and the work outside the lawsuit. */}
        <Box component="section" className="flex flex-col gap-3" aria-labelledby="area-edit-course">
          <SectionTitle
            id="area-edit-course"
            title={t("area-script-course-title")}
            description={t("area-script-course-info")}
            as="h3"
            variant="subtitle1"
          />
          <Typography variant="caption" className="text-text-secondary">
            {t("area-script-edit-stages")}
          </Typography>
          {script.etapas.map((stage, stageIndex) => (
            <Box key={stage.chave} className="flex flex-wrap items-end gap-2">
              <TextField
                {...field}
                className="outlined min-w-48 flex-1"
                id={`area-edit-stage-${stage.chave}`}
                label={t("area-script-edit-stage-name")}
                value={stage.nome}
                onChange={(event) => change((draft) => void (draft.etapas[stageIndex]!.nome = event.target.value))}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 80 } }}
              />
              <TextField
                {...field}
                select
                className="outlined w-44"
                id={`area-edit-stage-phase-${stage.chave}`}
                label={t("area-script-edit-phase")}
                value={stage.fase}
                onChange={(event) =>
                  change(
                    (draft) =>
                      void (draft.etapas[stageIndex]!.fase = event.target.value as (typeof SCRIPT_PHASES)[number]),
                  )
                }
                disabled={busy}
              >
                {SCRIPT_PHASES.map((phase) => (
                  <MenuItem key={phase} value={phase}>
                    {t(`area-script-phase-${phase}`)}
                  </MenuItem>
                ))}
              </TextField>
              {remove(t("area-script-edit-remove-stage", { name: stage.nome }), () =>
                change((draft) => void draft.etapas.splice(stageIndex, 1)),
              )}
            </Box>
          ))}
          {add(
            t("area-script-edit-add-stage"),
            () => change((draft) => void draft.etapas.push({ chave: newKey("etapa"), nome: "", fase: "processo" })),
            script.etapas.length >= SCRIPT_LIMITS.stages,
          )}
          <Typography variant="caption" className="text-text-secondary">
            {t("area-script-edit-works")}
          </Typography>
          {script.tarefas.map((work, workIndex) => (
            <Box key={work.chave} className="flex flex-col gap-2">
              <Box className="flex flex-wrap items-end gap-2">
                <TextField
                  {...field}
                  className="outlined min-w-48 flex-1"
                  id={`area-edit-work-${work.chave}`}
                  label={t("area-script-edit-work-name")}
                  value={work.nome}
                  onChange={(event) => change((draft) => void (draft.tarefas[workIndex]!.nome = event.target.value))}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
                <TextField
                  {...field}
                  select
                  className="outlined w-40"
                  id={`area-edit-work-who-${work.chave}`}
                  label={t("area-script-edit-worker")}
                  value={work.quem}
                  onChange={(event) =>
                    change(
                      (draft) =>
                        void (draft.tarefas[workIndex]!.quem = event.target.value as (typeof SCRIPT_WORKERS)[number]),
                    )
                  }
                  disabled={busy}
                >
                  {SCRIPT_WORKERS.map((worker) => (
                    <MenuItem key={worker} value={worker}>
                      {t(`area-script-worker-${worker}`)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  {...field}
                  select
                  className="outlined w-44"
                  id={`area-edit-work-phase-${work.chave}`}
                  label={t("area-script-edit-phase")}
                  value={work.fase}
                  onChange={(event) =>
                    change(
                      (draft) =>
                        void (draft.tarefas[workIndex]!.fase = event.target.value as (typeof SCRIPT_PHASES)[number]),
                    )
                  }
                  disabled={busy}
                >
                  {SCRIPT_PHASES.map((phase) => (
                    <MenuItem key={phase} value={phase}>
                      {t(`area-script-phase-${phase}`)}
                    </MenuItem>
                  ))}
                </TextField>
                {remove(t("area-script-edit-remove-work", { name: work.nome }), () =>
                  change((draft) => void draft.tarefas.splice(workIndex, 1)),
                )}
              </Box>
              {typesPicker(`area-edit-work-types-${work.chave}`, work.tipos, (keys) =>
                change((draft) => void (draft.tarefas[workIndex]!.tipos = keys)),
              )}
            </Box>
          ))}
          {add(
            t("area-script-edit-add-work"),
            () =>
              change(
                (draft) =>
                  void draft.tarefas.push({
                    chave: newKey("tarefa"),
                    nome: "",
                    quem: "escritorio",
                    fase: "documentos",
                    tipos: [],
                  }),
              ),
            script.tarefas.length >= SCRIPT_LIMITS.works,
          )}
        </Box>

        {/* The firm's words. */}
        <Box component="section" className="flex flex-col gap-3" aria-labelledby="area-edit-words">
          <SectionTitle
            id="area-edit-words"
            title={t("area-script-words-title")}
            description={t("area-script-words-info")}
            as="h3"
            variant="subtitle1"
          />
          <TextField
            {...field}
            id="area-edit-fees"
            label={t("area-script-fees")}
            value={script.honorarios}
            onChange={(event) => change((draft) => void (draft.honorarios = event.target.value))}
            multiline
            minRows={2}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 1500 } }}
          />
          <TextField
            {...field}
            id="area-edit-doubts"
            label={t("area-script-doubts")}
            value={script.duvidas}
            onChange={(event) => change((draft) => void (draft.duvidas = event.target.value))}
            multiline
            minRows={3}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 3000 } }}
          />
          <TextField
            {...field}
            id="area-edit-refusal"
            label={t("area-script-refusal")}
            value={script.recusa}
            onChange={(event) => change((draft) => void (draft.recusa = event.target.value))}
            multiline
            minRows={2}
            helperText={t("area-script-edit-refusal-help")}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </Box>

        {/* The courts and the sensitive data. */}
        <Box component="section" className="flex flex-col gap-3" aria-labelledby="area-edit-courts">
          <SectionTitle
            id="area-edit-courts"
            title={t("area-script-courts-title")}
            description={t("area-script-courts-info")}
            as="h3"
            variant="subtitle1"
          />
          {script.tribunais.map((court, courtIndex) => (
            <Box key={`court-${courtIndex}`} className="flex flex-wrap items-end gap-2">
              <TextField
                {...field}
                className="outlined w-40"
                id={`area-edit-court-${courtIndex}`}
                label={t("area-script-edit-court")}
                value={court.tribunal}
                onChange={(event) =>
                  change((draft) => void (draft.tribunais[courtIndex]!.tribunal = event.target.value))
                }
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
              <TextField
                {...field}
                className="outlined w-40"
                id={`area-edit-system-${courtIndex}`}
                label={t("area-script-edit-system")}
                value={court.sistema}
                onChange={(event) =>
                  change((draft) => void (draft.tribunais[courtIndex]!.sistema = event.target.value))
                }
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
              {remove(t("area-script-edit-remove-court", { name: court.tribunal }), () =>
                change((draft) => void draft.tribunais.splice(courtIndex, 1)),
              )}
            </Box>
          ))}
          {add(
            t("area-script-edit-add-court"),
            () => change((draft) => void draft.tribunais.push({ tribunal: "", sistema: "" })),
            script.tribunais.length >= SCRIPT_LIMITS.courts,
          )}
          {script.sensiveis.map((data, dataIndex) => (
            <Box key={`sensitive-${dataIndex}`} className="flex flex-wrap items-end gap-2">
              <TextField
                {...field}
                select
                className="outlined w-44"
                id={`area-edit-sensitive-kind-${dataIndex}`}
                label={t("area-script-edit-sensitive")}
                value={data.dado}
                onChange={(event) =>
                  change(
                    (draft) =>
                      void (draft.sensiveis[dataIndex]!.dado = event.target.value as (typeof SENSITIVE_DATA)[number]),
                  )
                }
                disabled={busy}
              >
                {SENSITIVE_DATA.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {t(`area-script-sensitive-${kind}`)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                {...field}
                className="outlined min-w-48 flex-1"
                id={`area-edit-sensitive-name-${dataIndex}`}
                label={t("area-script-edit-sensitive-name")}
                value={data.nome}
                onChange={(event) => change((draft) => void (draft.sensiveis[dataIndex]!.nome = event.target.value))}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <TextField
                {...field}
                type="number"
                className="outlined w-32"
                id={`area-edit-sensitive-years-${dataIndex}`}
                label={t("area-script-edit-sensitive-years")}
                value={data.guarda_anos}
                onChange={(event) =>
                  change(
                    (draft) =>
                      void (draft.sensiveis[dataIndex]!.guarda_anos = Math.min(
                        30,
                        Math.max(1, Math.round(Number(event.target.value) || 1)),
                      )),
                  )
                }
                disabled={busy}
                slotProps={{ htmlInput: { min: 1, max: 30, step: 1 } }}
              />
              {remove(t("area-script-edit-remove-sensitive", { name: data.nome }), () =>
                change((draft) => void draft.sensiveis.splice(dataIndex, 1)),
              )}
            </Box>
          ))}
          {add(
            t("area-script-edit-add-sensitive"),
            () => change((draft) => void draft.sensiveis.push({ dado: "saude", nome: "", guarda_anos: 5 })),
            script.sensiveis.length >= SCRIPT_LIMITS.sensitive,
          )}
        </Box>

        {error ? <StateLine tone="failed">{error}</StateLine> : null}
      </Box>
    </SidePanel>
  );
}
