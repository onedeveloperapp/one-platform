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
  FormGroup,
  FormHelperText,
  FormLabel,
  Input,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from "@mui/material";

import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import {
  areaName,
  areaNameOk,
  type FirmOperation,
  hoursOk,
  type KnownArea,
  MONTHLY_BANDS,
  OPERATION_CHANNELS,
  OPERATION_WORKS,
  type OperationArea,
  type OperationChannel,
  PREVIOUS_SYSTEMS,
} from "@/lib/firm/operation";
import { type AreaProposalResult, proposeFirmAreas, saveFirmOperation } from "@/lib/firm/operation-actions";
import { OAB_STATES } from "@/lib/firm/roles";

/** The systems whose portfolio comes into ONE by the import of `/casos/importar`. */
const IMPORTED = new Set(["astrea", "advbox", "projuris", "planilha"]);

/**
 * The setup's step "A operação" (migration 0256, the owner, 2026-11-20): the areas the firm works in, which ONE
 * proposes from the firm's lawsuits and the person confirms, takes out or adds to; where and how it works; and who does
 * each work. The areas decide the way a new contact on the WhatsApp goes, and ONE answers nobody new before they are
 * said. The step is placed by the setup's flow, which owns the wizard.
 */
export function useOperationStep(input: {
  answered: boolean;
  operation: FirmOperation;
  areas: OperationArea[];
  knownAreas: KnownArea[];
  /** The states of the registrations at the bar of who answers: ONE's proposal of where the firm works. */
  registrationStates: string[];
  blocked: boolean;
}): Pick<WizardStep, "content" | "canAdvance" | "onPrimary"> {
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

  const addOwn = () => {
    const name = areaName(ownDraft);
    if (!areaNameOk(name)) {
      setOwnError(t("setup-operation-error-invalid_area_name"));
      return;
    }
    // A name that is an area ONE knows is that area.
    const known = input.knownAreas.find((area) => area.name.toLowerCase() === name.toLowerCase());
    if (known) {
      setChosen((current) => new Set([...current, known.key]));
    } else if (!own.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setOwn((current) => [...current, name]);
    }
    setTouched(true);
    setOwnDraft("");
    setOwnError(null);
  };

  // ---------- How it works ----------
  const [operation, setOperation] = useState<FirmOperation>(() =>
    input.answered || input.operation.states.length > 0
      ? input.operation
      : { ...input.operation, states: [...new Set(input.registrationStates)] },
  );
  const set = <K extends keyof FirmOperation>(key: K, value: FirmOperation[K]) =>
    setOperation((current) => ({ ...current, [key]: value }));
  const hoursRight = hoursOk(operation);

  const [error, setError] = useState<string | null>(null);
  const areasCount = chosen.size + own.length;

  const onPrimary = async (): Promise<boolean> => {
    setError(null);
    if (areasCount === 0) {
      setError(t("setup-operation-error-no_areas"));
      return false;
    }
    const areas: OperationArea[] = [
      ...[...chosen].map((key) => ({
        lawArea: key,
        name: input.knownAreas.find((area) => area.key === key)?.name ?? key,
        source: (proposedKeys.has(key) && !input.areas.some((area) => area.lawArea === key)
          ? "xray"
          : "person") as OperationArea["source"],
      })),
      ...own.map((name) => ({ lawArea: null, name, source: "person" as const })),
    ];
    const saved = await saveFirmOperation({ operation, areas }).catch(() => ({ ok: false as const, code: "failed" }));
    if (saved.ok) return true;
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

  // ---------- What the step shows ----------
  const reading: ReactNode =
    proposal === null ? (
      <StateLine tone="waiting">{t("setup-operation-reading")}</StateLine>
    ) : proposal.ok && proposal.source !== "none" && proposal.lawsuits > 0 ? (
      <Typography variant="body2" className="text-text-secondary">
        {proposal.source === "djen"
          ? t("setup-operation-read-djen", { count: proposal.lawsuits })
          : t("setup-operation-read-publications", { count: proposal.lawsuits })}
      </Typography>
    ) : (
      <Typography variant="body2" className="text-text-secondary">
        {t("setup-operation-read-none")}
      </Typography>
    );

  const question = (id: string, text: string, field: ReactNode, help?: ReactNode) => (
    <FormControl component="fieldset" className="flex flex-col gap-1" variant="standard">
      <FormLabel component="legend" id={id} className="text-text-primary mb-1 text-sm font-medium">
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
        <FormGroup className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {input.knownAreas.map((area) => {
            const fixed = moduleAreas.has(area.key);
            const lawsuits = lawsuitsOf(area.key);
            return (
              <FormControlLabel
                key={area.key}
                className="m-0 items-start py-1"
                control={
                  <Checkbox
                    checked={fixed || chosen.has(area.key)}
                    onChange={() => toggle(area.key)}
                    disabled={fixed || input.blocked}
                    className="pt-0.5"
                  />
                }
                label={
                  <Box className="flex min-w-0 flex-col">
                    <Typography variant="subtitle2" component="span">
                      {area.name}
                    </Typography>
                    <Typography variant="caption" component="span" className="text-text-secondary">
                      {fixed
                        ? t("setup-operation-module")
                        : lawsuits > 0
                          ? t("setup-operation-lawsuits", { count: lawsuits })
                          : area.covers}
                    </Typography>
                  </Box>
                }
              />
            );
          })}
        </FormGroup>
        {own.length > 0 ? (
          <Box className="flex flex-wrap gap-2">
            {own.map((name) => (
              <Chip
                key={name}
                label={name}
                onDelete={
                  input.blocked
                    ? undefined
                    : () => {
                        setTouched(true);
                        setOwn((current) => current.filter((item) => item !== name));
                      }
                }
                aria-label={name}
              />
            ))}
          </Box>
        ) : null}
        <Box className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <TextField
            id="setup-operation-own"
            label={t("setup-operation-own-label")}
            value={ownDraft}
            onChange={(event) => setOwnDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addOwn();
              }
            }}
            error={Boolean(ownError)}
            helperText={ownError ?? t("setup-operation-own-help")}
            disabled={input.blocked}
            variant="standard"
            className="outlined flex-1"
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <Button variant="outlined" onClick={addOwn} disabled={input.blocked || !ownDraft.trim()} className="sm:mt-4">
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
            // The question is the legend of the field's fieldset, which names the field.
            id="setup-operation-states"
            renderInput={(params) => <TextField {...params} variant="standard" />}
          />,
          input.registrationStates.length > 0 ? t("setup-operation-states-help") : undefined,
        )}
        {question(
          "setup-operation-channels-label",
          t("setup-operation-channels"),
          <FormGroup className="grid grid-cols-1 sm:grid-cols-2">
            {OPERATION_CHANNELS.map((channel) => (
              <FormControlLabel
                key={channel}
                control={
                  <Checkbox
                    checked={operation.channels.includes(channel)}
                    onChange={(event) =>
                      set(
                        "channels",
                        (event.target.checked
                          ? [...operation.channels, channel]
                          : operation.channels.filter((item) => item !== channel)) as OperationChannel[],
                      )
                    }
                    disabled={input.blocked}
                  />
                }
                label={t(`setup-operation-channel-${channel}`)}
              />
            ))}
          </FormGroup>,
        )}
        {question(
          "setup-operation-monthly-label",
          t("setup-operation-monthly"),
          <RadioGroup
            row
            aria-labelledby="setup-operation-monthly-label"
            value={operation.monthlyCases ?? ""}
            onChange={(event) => set("monthlyCases", event.target.value as FirmOperation["monthlyCases"])}
          >
            {MONTHLY_BANDS.map((band) => (
              <FormControlLabel
                key={band}
                value={band}
                control={<Radio disabled={input.blocked} />}
                label={t(`setup-operation-monthly-${band}`)}
              />
            ))}
          </RadioGroup>,
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
        {question(
          "setup-operation-system-label",
          t("setup-operation-system"),
          <Select
            variant="standard"
            className="outlined max-w-xs"
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

      <Box component="section" className="flex flex-col gap-4" aria-labelledby="setup-operation-works">
        <SectionTitle
          id="setup-operation-works"
          title={t("setup-operation-works-title")}
          description={t("setup-operation-works-info")}
          as="h3"
          variant="subtitle1"
        />
        {OPERATION_WORKS.map((work) =>
          question(
            `setup-operation-work-${work}-label`,
            t(`setup-operation-work-${work}`),
            <RadioGroup
              row
              aria-labelledby={`setup-operation-work-${work}-label`}
              value={operation.works[work] === null ? "" : operation.works[work] ? "sim" : "nao"}
              onChange={(event) => set("works", { ...operation.works, [work]: event.target.value === "sim" })}
            >
              <FormControlLabel
                value="sim"
                control={<Radio disabled={input.blocked} />}
                label={t("setup-operation-yes")}
              />
              <FormControlLabel
                value="nao"
                control={<Radio disabled={input.blocked} />}
                label={t("setup-operation-no")}
              />
            </RadioGroup>,
          ),
        )}
      </Box>

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );

  return { content, canAdvance: areasCount > 0 && hoursRight && !input.blocked, onPrimary };
}
