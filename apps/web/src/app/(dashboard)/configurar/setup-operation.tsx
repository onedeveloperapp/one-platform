"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";

import ChoiceChips from "@/components/product/choice-chips";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import NiCheck from "@/icons/nexture/ni-check";
import {
  areaName,
  areaNameOk,
  type FirmOperation,
  hoursOk,
  type KnownArea,
  MONTHLY_BANDS,
  OPERATION_CHANNELS,
  type OperationArea,
  type OperationChannel,
  type OperationWork,
  PREVIOUS_SYSTEMS,
} from "@/lib/firm/operation";
import { type AreaProposalResult, proposeFirmAreas, saveFirmOperation } from "@/lib/firm/operation-actions";
import { OAB_STATES } from "@/lib/firm/roles";

/** The systems whose portfolio comes into ONE by the import of `/casos/importar`. */
const IMPORTED = new Set(["astrea", "advbox", "projuris", "planilha"]);

/**
 * A yes or no of the setup, as two buttons side by side: a choice, never a save (the owner's canvas of 2026-11-24,
 * where radio buttons ran into the label before them: "Sim◯ Não").
 */
export function YesNo({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  return (
    <ChoiceChips
      single
      label={label}
      options={[
        { value: "sim", label: t("setup-operation-yes") },
        { value: "nao", label: t("setup-operation-no") },
      ]}
      selected={value === null ? [] : [value ? "sim" : "nao"]}
      onToggle={(next) => onChange(next === "sim")}
      disabled={disabled}
    />
  );
}

/** A question of the setup with its answer beside it on a wide screen, under it on a narrow one. */
export function SetupQuestion({ id, text, children }: { id: string; text: ReactNode; children: ReactNode }) {
  return (
    <Box className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <Typography id={id} variant="body2" component="span" className="text-text-primary">
        {text}
      </Typography>
      <Box className="flex-none">{children}</Box>
    </Box>
  );
}

/**
 * The setup's step "Como o escritório trabalha" (migration 0256, the owner, 2026-11-20, and the canvas of
 * 2026-11-24): the areas the firm works in, which ONE proposes from the firm's lawsuits and the person confirms, takes
 * out or adds to; where and when it works; how its clients arrive and how many; and whether ONE keeps its books. The
 * areas decide the way a new contact on the WhatsApp goes, and ONE answers nobody new before they are said.
 *
 * The answers live here, with the flow, and two of them are asked in later steps where they belong: whether ONE
 * prepares the filing packages (the step of the filing) and whether the firm has a controladoria (the team's step).
 * Whether it takes clients from agencies is the channel "Por uma agência ou um parceiro", never asked twice. Every
 * save sends the whole answer, as `save_firm_operation` takes it; a later step saves its answer only once this one was
 * answered, so ONE's proposal of the areas is never kept as the firm's without the person seeing it.
 */
export function useOperationStep(input: {
  answered: boolean;
  operation: FirmOperation;
  areas: OperationArea[];
  knownAreas: KnownArea[];
  /** The states of the registrations at the bar of who answers: ONE's proposal of where the firm works. */
  registrationStates: string[];
  blocked: boolean;
}): Pick<WizardStep, "content" | "canAdvance" | "onPrimary" | "onLeave" | "done"> & {
  works: FirmOperation["works"];
  setWork: (work: OperationWork, value: boolean) => void;
  /** Saves the answers of a later step with the rest, once the step was answered; true when nothing was owed. */
  saveWorks: () => Promise<boolean>;
} {
  const t = useTranslations("product");

  // ---------- The areas ----------
  const moduleAreas = useMemo(
    () => new Set(input.areas.filter((area) => area.source === "module" && area.lawArea).map((area) => area.lawArea!)),
    [input.areas],
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(input.areas.map((area) => area.lawArea).filter((key): key is string => Boolean(key))),
  );
  const [proposedKeys, setProposedKeys] = useState<Set<string>>(() => new Set());
  const [own, setOwn] = useState<string[]>(() =>
    input.areas.filter((area) => area.lawArea === null).map((area) => area.name),
  );
  const [ownDraft, setOwnDraft] = useState("");
  const [ownError, setOwnError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [proposal, setProposal] = useState<AreaProposalResult | null>(null);
  // Answered before, or saved in this visit: a later step may then save its own answer with the rest.
  const [answered, setAnswered] = useState(input.answered);

  // ONE reads the firm's lawsuits once the step opens, and marks what weighs, unless the person already chose.
  useEffect(() => {
    let open = true;
    proposeFirmAreas()
      .then((result) => {
        if (!open) return;
        setProposal(result);
        if (!result.ok) return;
        const weighs = result.areas.filter((area) => area.proposed).map((area) => area.area);
        setProposedKeys(new Set(weighs));
        if (!input.answered) setChosen((current) => (touched ? current : new Set([...current, ...weighs])));
      })
      .catch(() => {
        if (open) setProposal({ ok: false, code: "failed" });
      });
    return () => {
      open = false;
    };
    // Once, when the step opens: what the person chooses afterwards is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lawsuitsOf = (key: string): number =>
    proposal?.ok ? (proposal.areas.find((area) => area.area === key)?.lawsuits ?? 0) : 0;

  const toggle = (key: string) => {
    setTouched(true);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** The area typed in "Outra área", taken as it is: by its button, by Enter, or by "Continuar". */
  const takeOwn = (): { chosen: Set<string>; own: string[] } | null => {
    const typed = ownDraft.trim();
    if (!typed) return { chosen, own };
    const name = areaName(typed);
    if (!areaNameOk(name)) {
      setOwnError(t("setup-operation-error-invalid_area_name"));
      return null;
    }
    // A name that is an area ONE knows is that area.
    const known = input.knownAreas.find((area) => area.name.toLowerCase() === name.toLowerCase());
    const nextChosen = known ? new Set([...chosen, known.key]) : chosen;
    const nextOwn = known || own.some((item) => item.toLowerCase() === name.toLowerCase()) ? own : [...own, name];
    setChosen(nextChosen);
    setOwn(nextOwn);
    setTouched(true);
    setOwnDraft("");
    setOwnError(null);
    return { chosen: nextChosen, own: nextOwn };
  };

  // ---------- How it works ----------
  const [operation, setOperation] = useState<FirmOperation>(() =>
    input.answered || input.operation.states.length > 0
      ? input.operation
      : { ...input.operation, states: [...new Set(input.registrationStates)] },
  );
  const set = <K extends keyof FirmOperation>(key: K, value: FirmOperation[K]) =>
    setOperation((current) => ({ ...current, [key]: value }));
  const setWork = (work: OperationWork, value: boolean) =>
    setOperation((current) => ({ ...current, works: { ...current.works, [work]: value } }));
  const hoursRight = hoursOk(operation);

  const [error, setError] = useState<string | null>(null);
  const areasCount = chosen.size + own.length + (ownDraft.trim() ? 1 : 0);

  const areasOf = (picked: Set<string>, named: string[]): OperationArea[] => [
    ...[...picked].map((key) => ({
      lawArea: key,
      name: input.knownAreas.find((area) => area.key === key)?.name ?? key,
      source: (proposedKeys.has(key) && !input.areas.some((area) => area.lawArea === key)
        ? "xray"
        : "person") as OperationArea["source"],
    })),
    ...named.map((name) => ({ lawArea: null, name, source: "person" as const })),
  ];

  const save = async (picked: Set<string>, named: string[]): Promise<boolean> => {
    setError(null);
    if (picked.size + named.length === 0) {
      setError(t("setup-operation-error-no_areas"));
      return false;
    }
    const saved = await saveFirmOperation({ operation, areas: areasOf(picked, named) }).catch(() => ({
      ok: false as const,
      code: "failed",
    }));
    if (saved.ok) {
      setAnswered(true);
      return true;
    }
    const code = saved.code;
    setError(
      code === "areas_limit"
        ? t("setup-operation-error-areas_limit", { limit: "limit" in saved ? (saved.limit ?? 0) : 0 })
        : code === "second_factor_required"
          ? t("setup-operation-error-second_factor")
          : code === "no_areas" || code === "invalid_area_name"
            ? t(`setup-operation-error-${code}`)
            : t("setup-operation-error-failed"),
    );
    return false;
  };

  const onPrimary = async (): Promise<boolean> => {
    const taken = takeOwn();
    if (!taken) return false;
    return save(taken.chosen, taken.own);
  };

  const saveWorks = async (): Promise<boolean> =>
    answered && !input.blocked && chosen.size + own.length > 0 && hoursRight ? save(chosen, own) : true;

  // ---------- What the step shows ----------
  const reading: ReactNode =
    proposal === null ? (
      <StateLine tone="waiting">{t("setup-operation-reading")}</StateLine>
    ) : proposal.ok && proposal.source !== "none" && proposal.lawsuits > 0 ? (
      <StateLine tone="info">
        {proposal.source === "djen"
          ? t("setup-operation-read-djen", { count: proposal.lawsuits })
          : t("setup-operation-read-publications", { count: proposal.lawsuits })}
      </StateLine>
    ) : (
      <StateLine tone="info">{t("setup-operation-read-none")}</StateLine>
    );

  const question = (id: string, text: string, field: ReactNode, help?: ReactNode) => (
    <FormControl component="fieldset" className="flex flex-col gap-2" variant="standard">
      <FormLabel component="legend" id={id} className="text-text-primary mb-1 text-sm font-semibold">
        {text}
      </FormLabel>
      {field}
      {help ? <FormHelperText>{help}</FormHelperText> : null}
    </FormControl>
  );

  const content = (
    <Box className="flex flex-col gap-6">
      <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-operation-areas">
        <SectionTitle
          id="setup-operation-areas"
          title={t("setup-operation-areas-title")}
          description={t("setup-operation-areas-info")}
          as="h3"
          variant="subtitle1"
        />
        {reading}
        <Box className="flex flex-wrap gap-2">
          <ChoiceChips
            labelledBy="setup-operation-areas"
            options={input.knownAreas.map((area) => {
              const fixed = moduleAreas.has(area.key);
              const lawsuits = lawsuitsOf(area.key);
              const note = fixed
                ? t("setup-operation-module")
                : lawsuits > 0
                  ? t("setup-operation-lawsuits", { count: lawsuits })
                  : null;
              return { value: area.key, label: note ? `${area.name} · ${note}` : area.name, fixed };
            })}
            selected={[...chosen]}
            onToggle={toggle}
            disabled={input.blocked}
          />
          {own.map((name) => (
            <Chip
              key={`own-${name}`}
              label={name}
              icon={<NiCheck size="small" />}
              color="primary"
              className="font-semibold"
              onDelete={
                input.blocked
                  ? undefined
                  : () => {
                      setTouched(true);
                      setOwn((current) => current.filter((item) => item !== name));
                    }
              }
            />
          ))}
        </Box>
        <Box className="flex flex-row items-start gap-2">
          <TextField
            id="setup-operation-own"
            label={t("setup-operation-own-label")}
            value={ownDraft}
            onChange={(event) => {
              setOwnDraft(event.target.value);
              setOwnError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                takeOwn();
              }
            }}
            error={Boolean(ownError)}
            helperText={ownError ?? t("setup-operation-own-help")}
            disabled={input.blocked}
            size="small"
            className="flex-1"
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <Button
            variant="text"
            color="grey"
            onClick={() => takeOwn()}
            disabled={input.blocked || !ownDraft.trim()}
            className="mt-0.5"
          >
            {t("setup-operation-own-add")}
          </Button>
        </Box>
      </Box>

      <Box component="section" className="flex flex-col gap-4" aria-labelledby="setup-operation-where">
        <SectionTitle id="setup-operation-where" title={t("setup-operation-where-title")} as="h3" variant="subtitle1" />
        {question(
          "setup-operation-states-label",
          t("setup-operation-states"),
          <Autocomplete
            multiple
            options={[...OAB_STATES]}
            value={operation.states}
            onChange={(_event, value) => set("states", value)}
            disabled={input.blocked}
            id="setup-operation-states"
            openText={t("setup-operation-states-open")}
            closeText={t("setup-operation-states-close")}
            clearText={t("setup-operation-states-clear")}
            noOptionsText={t("setup-operation-states-none")}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                slotProps={{
                  ...params.slotProps,
                  htmlInput: { ...params.slotProps.htmlInput, "aria-labelledby": "setup-operation-states-label" },
                }}
              />
            )}
          />,
          input.registrationStates.length > 0 ? t("setup-operation-states-help") : undefined,
        )}
        {question(
          "setup-operation-hours-label",
          t("setup-operation-hours"),
          <Box className="flex flex-wrap items-end gap-4">
            <FormControl variant="standard" className="outlined w-32">
              <FormLabel component="label" htmlFor="setup-operation-from">
                {t("setup-operation-hours-from")}
              </FormLabel>
              <Input
                id="setup-operation-from"
                type="time"
                value={operation.hoursFrom ?? ""}
                onChange={(event) => set("hoursFrom", event.target.value || null)}
                disabled={input.blocked}
              />
            </FormControl>
            <FormControl variant="standard" className="outlined w-32">
              <FormLabel component="label" htmlFor="setup-operation-to">
                {t("setup-operation-hours-to")}
              </FormLabel>
              <Input
                id="setup-operation-to"
                type="time"
                value={operation.hoursTo ?? ""}
                onChange={(event) => set("hoursTo", event.target.value || null)}
                disabled={input.blocked}
              />
            </FormControl>
            <FormControlLabel
              control={
                <Checkbox
                  checked={operation.saturdays}
                  onChange={(event) => set("saturdays", event.target.checked)}
                  disabled={input.blocked}
                />
              }
              label={t("setup-operation-saturdays")}
            />
          </Box>,
          hoursRight ? undefined : (
            <Box component="span" className="text-error">
              {t("setup-operation-hours-invalid")}
            </Box>
          ),
        )}
      </Box>

      <Box component="section" className="flex flex-col gap-4" aria-labelledby="setup-operation-clients">
        <SectionTitle
          id="setup-operation-clients"
          title={t("setup-operation-clients-title")}
          as="h3"
          variant="subtitle1"
        />
        {question(
          "setup-operation-channels-label",
          t("setup-operation-channels"),
          <ChoiceChips
            labelledBy="setup-operation-channels-label"
            options={OPERATION_CHANNELS.map((channel) => ({
              value: channel,
              label: t(`setup-operation-channel-${channel}`),
            }))}
            selected={operation.channels}
            onToggle={(channel) =>
              set(
                "channels",
                (operation.channels.includes(channel)
                  ? operation.channels.filter((item) => item !== channel)
                  : [...operation.channels, channel]) as OperationChannel[],
              )
            }
            disabled={input.blocked}
          />,
        )}
        {question(
          "setup-operation-monthly-label",
          t("setup-operation-monthly"),
          <ChoiceChips
            single
            labelledBy="setup-operation-monthly-label"
            options={MONTHLY_BANDS.map((band) => ({ value: band, label: t(`setup-operation-monthly-${band}`) }))}
            selected={operation.monthlyCases ? [operation.monthlyCases] : []}
            onToggle={(band) => set("monthlyCases", band)}
            disabled={input.blocked}
          />,
        )}
      </Box>

      <Box component="section" className="flex flex-col gap-4" aria-labelledby="setup-operation-works">
        <SectionTitle
          id="setup-operation-works"
          title={t("setup-operation-works-title")}
          description={t("setup-operation-works-info")}
          as="h3"
          variant="subtitle1"
        />
        <SetupQuestion id="setup-operation-work-one_finance-label" text={t("setup-operation-work-one_finance")}>
          <YesNo
            label={t("setup-operation-work-one_finance")}
            value={operation.works.one_finance}
            onChange={(value) => setWork("one_finance", value)}
            disabled={input.blocked}
          />
        </SetupQuestion>
        {question(
          "setup-operation-system-label",
          t("setup-operation-system"),
          <Select
            size="small"
            className="max-w-xs"
            value={operation.previousSystem ?? ""}
            displayEmpty
            onChange={(event) => set("previousSystem", (event.target.value || null) as FirmOperation["previousSystem"])}
            disabled={input.blocked}
            inputProps={{ "aria-labelledby": "setup-operation-system-label" }}
          >
            <MenuItem value="" disabled>
              {t("setup-operation-system-placeholder")}
            </MenuItem>
            {PREVIOUS_SYSTEMS.map((system) => (
              <MenuItem key={system} value={system}>
                {t(`setup-operation-system-${system}`)}
              </MenuItem>
            ))}
          </Select>,
          operation.previousSystem && IMPORTED.has(operation.previousSystem)
            ? t("setup-operation-system-import")
            : undefined,
        )}
      </Box>

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );

  return {
    content,
    canAdvance: areasCount > 0 && hoursRight && !input.blocked,
    onPrimary,
    onLeave: onPrimary,
    done: answered,
    works: operation.works,
    setWork,
    saveWorks,
  };
}
