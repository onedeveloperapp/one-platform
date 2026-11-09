"use client";

import type { GoalPartnership } from "./load-goals";
import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
} from "@mui/material";

import SidePanel from "@/components/product/side-panel";
import NiFlag from "@/icons/nexture/ni-flag";
import {
  type ClosingGoal,
  GOAL_ORIGINS,
  goalErrorKey,
  MOST_PERIOD_DAYS,
  MOST_TARGET,
  ORIGIN_KEY,
  periodPresets,
} from "@/lib/controladoria/goals";
import { saveClosingGoal } from "@/lib/controladoria/goals-actions";
import type { ModuleCard } from "@/lib/modules/offer";
import { caseKindLabelKey, caseKindsOf, firmCaseKinds } from "@/lib/modules/registry";

type Preset = "month" | "next" | "quarter" | "custom";
const PRESETS: readonly Preset[] = ["month", "next", "quarter", "custom"];
const PRESET_KEY: Record<Preset, string> = {
  month: "goals-period-this-month",
  next: "goals-period-next-month",
  quarter: "goals-period-this-quarter",
  custom: "goals-period-other",
};

/** An empty choice is an option like the others ("Todos os tipos"): shown as chosen, with the field's label above it. */
const CHOICE_SLOTS = { inputLabel: { shrink: true }, select: { displayEmpty: true } };

/**
 * A closing goal created or changed in the side panel (migration 0113; the pattern of every registration since phase
 * 0): the period (this month, the next, this quarter, or two days), the part of the cases (a module, a kind of
 * problem, where they came from, one partner agency; each left as every one) and how many closings. The database
 * decides who may and checks the module and the agency; what it refuses is said in the panel, the words typed kept.
 */
export default function GoalPanel({
  goal,
  today,
  modules,
  scope,
  partnerships,
  onClose,
  onSaved,
}: {
  /** The goal changed, or null for a new one. */
  goal: ClosingGoal | null;
  today: string;
  modules: ModuleCard[];
  /** The module the page is of: a goal of the page is of that module. */
  scope: ModuleCard | null;
  partnerships: GoalPartnership[];
  onClose: () => void;
  /** The period it was saved with: the list goes to the view it landed in. */
  onSaved: (period: { startsOn: string; endsOn: string }) => void;
}) {
  const t = useTranslations("product");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const presets = periodPresets(today);
  const presetOf = (startsOn: string, endsOn: string): Preset =>
    (["month", "next", "quarter"] as const).find(
      (key) => presets[key].startsOn === startsOn && presets[key].endsOn === endsOn,
    ) ?? "custom";

  const formik = useFormik({
    initialValues: {
      preset: goal ? presetOf(goal.startsOn, goal.endsOn) : ("month" as Preset),
      startsOn: goal?.startsOn ?? presets.month.startsOn,
      endsOn: goal?.endsOn ?? presets.month.endsOn,
      module: goal?.module ?? scope?.key ?? "",
      incident: goal?.incident ?? "",
      origin: goal?.origin ?? "",
      partnership: goal?.partnership ?? "",
      target: goal ? String(goal.target) : "",
    },
    validationSchema: yup.object({
      target: yup
        .number()
        .typeError(t("goals-error-target"))
        .required(t("goals-error-target"))
        .integer(t("goals-error-target"))
        .min(1, t("goals-error-target"))
        .max(MOST_TARGET, t("goals-error-target")),
      startsOn: yup.string().required(t("goals-error-period")),
      endsOn: yup
        .string()
        .required(t("goals-error-period"))
        .test("period", t("goals-error-period"), function check(endsOn) {
          const startsOn = this.parent.startsOn as string;
          if (!startsOn || !endsOn) return false;
          const span = (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
          return span >= 0 && span <= MOST_PERIOD_DAYS;
        }),
    }),
    validateOnBlur: true,
    onSubmit: async (values) => {
      setErrorCode(null);
      const period = values.preset === "custom" ? values : presets[values.preset];
      let answer: Awaited<ReturnType<typeof saveClosingGoal>>;
      try {
        answer = await saveClosingGoal({
          id: goal?.id ?? null,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          module: values.module || null,
          incident: values.incident || null,
          origin: values.origin || null,
          partnership: values.origin === "agency" ? values.partnership || null : null,
          target: Number(values.target),
        });
      } catch {
        answer = { ok: false, code: "failed" };
      }
      if (!answer.ok) {
        setErrorCode(answer.code);
        return;
      }
      onSaved({ startsOn: period.startsOn, endsOn: period.endsOn });
    },
  });

  const busy = formik.isSubmitting;
  const values = formik.values;
  // The kinds of problem of the module chosen, else of the firm's modules.
  const kinds = values.module ? caseKindsOf(values.module) : firmCaseKinds(modules.map((module) => module.key));
  const agencies = partnerships.filter((item) => !values.module || item.module === values.module);
  const choosesModule = !scope && modules.length > 1;
  const targetError = formik.touched.target ? formik.errors.target : undefined;
  const periodError = formik.touched.endsOn || formik.submitCount > 0 ? formik.errors.endsOn : undefined;
  const set = (field: string, value: string) => void formik.setFieldValue(field, value);

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("goals-close")}
      icon={<NiFlag size="medium" />}
      tone="primary"
      busy={busy}
      title={goal ? t("goals-panel-edit") : t("goals-panel-new")}
      description={t("goals-panel-body")}
      onSubmit={() => void formik.submitForm()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("goals-saving") : t("goals-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("goals-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {errorCode ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(goalErrorKey(errorCode))}
          </Alert>
        ) : null}

        <FormControl component="fieldset" error={Boolean(periodError)}>
          <FormLabel component="legend" id="goal-period" className="mb-1">
            {t("goals-field-period")}
          </FormLabel>
          <RadioGroup
            aria-labelledby="goal-period"
            name="preset"
            value={values.preset}
            onChange={(event) => {
              const preset = event.target.value as Preset;
              set("preset", preset);
              if (preset !== "custom") {
                set("startsOn", presets[preset].startsOn);
                set("endsOn", presets[preset].endsOn);
              }
            }}
          >
            {PRESETS.map((preset) => (
              <FormControlLabel
                key={preset}
                value={preset}
                disabled={busy}
                control={<Radio size="small" />}
                label={t(PRESET_KEY[preset])}
              />
            ))}
          </RadioGroup>
          {values.preset === "custom" ? (
            <Box className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                size="small"
                type="date"
                id="goal-starts-on"
                name="startsOn"
                label={t("goals-field-starts")}
                value={values.startsOn}
                disabled={busy}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                type="date"
                id="goal-ends-on"
                name="endsOn"
                label={t("goals-field-ends")}
                value={values.endsOn}
                disabled={busy}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={Boolean(periodError)}
                helperText={periodError}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
          ) : null}
        </FormControl>

        {choosesModule ? (
          <TextField
            select
            size="small"
            slotProps={CHOICE_SLOTS}
            id="goal-module"
            label={t("goals-field-module")}
            value={values.module}
            disabled={busy}
            onChange={(event) => {
              set("module", event.target.value);
              set("incident", "");
              set("partnership", "");
            }}
          >
            <MenuItem value="">{t("goals-module-all")}</MenuItem>
            {modules.map((module) => (
              <MenuItem key={module.key} value={module.key}>
                {module.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <TextField
          select
          size="small"
          slotProps={CHOICE_SLOTS}
          id="goal-incident"
          label={t("goals-field-incident")}
          value={values.incident}
          disabled={busy}
          onChange={(event) => set("incident", event.target.value)}
        >
          <MenuItem value="">{t("goals-incident-all")}</MenuItem>
          {kinds.map((kind) => (
            <MenuItem key={kind.key} value={kind.key}>
              {t(caseKindLabelKey(kind.key) ?? "case-incident-other")}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          slotProps={CHOICE_SLOTS}
          id="goal-origin"
          label={t("goals-field-origin")}
          value={values.origin}
          disabled={busy}
          onChange={(event) => {
            set("origin", event.target.value);
            if (event.target.value !== "agency") set("partnership", "");
          }}
        >
          <MenuItem value="">{t("goals-origin-any")}</MenuItem>
          {GOAL_ORIGINS.map((origin) => (
            <MenuItem key={origin} value={origin}>
              {t(ORIGIN_KEY[origin])}
            </MenuItem>
          ))}
        </TextField>

        {values.origin === "agency" && agencies.length > 0 ? (
          <TextField
            select
            size="small"
            slotProps={CHOICE_SLOTS}
            id="goal-partnership"
            label={t("goals-field-partner")}
            value={values.partnership}
            disabled={busy}
            onChange={(event) => set("partnership", event.target.value)}
          >
            <MenuItem value="">{t("goals-partner-any")}</MenuItem>
            {agencies.map((agency) => (
              <MenuItem key={agency.id} value={agency.id}>
                {agency.ended ? t("goals-partner-ended", { name: agency.name }) : agency.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <TextField
          size="small"
          id="goal-target"
          name="target"
          type="number"
          label={t("goals-field-target")}
          value={values.target}
          disabled={busy}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          error={Boolean(targetError)}
          helperText={targetError ?? t("goals-field-target-help")}
          slotProps={{ htmlInput: { min: 1, max: MOST_TARGET, step: 1, inputMode: "numeric" } }}
        />
      </Box>
    </SidePanel>
  );
}
