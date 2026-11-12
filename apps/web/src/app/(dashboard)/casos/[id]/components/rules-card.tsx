"use client";

import type { CaseState } from "../case-types";
import { type CaseActionWords, sentence, useCaseAction } from "./case-action";
import { CivilCourtAnswers, FamilyPlanBox } from "./family-court";
import FreeJusticeAnswers from "./free-justice";
import QualificationBlock from "./qualification-block";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import { CurrencyField } from "@/components/product/fields";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { caseErrorKey } from "@/lib/cases/cases";
import { createPlannedProceedings, readCaseWeather, saveSuspension, setPartyClaim } from "@/lib/cases/rule-actions";
import {
  caseDomicile,
  GROUND_KEY,
  isMinorParty,
  PLAN_REASON_KEY,
  RISK_KEY,
  ruleParties,
  SIGN_KEY,
  STATED_CAUSE_KEY,
} from "@/lib/cases/rules";
import { opensOnArrival } from "@/lib/cases/sections";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { planProceedings } from "@flyee/rules/proceedings";
import { specificitiesOf } from "@flyee/rules/specificities";
import { STATED_CAUSES, type StatedCause, type SuspensionRisk, triageSuspension } from "@flyee/rules/suspension";
import type { WeatherSign } from "@flyee/rules/weather";

type Ready = Extract<CaseState, { kind: "ready" }>;

const KIND_KEY = { juizado: "case-proceeding-kind-juizado", comum: "case-proceeding-kind-comum" } as const;

const RISK_TONE: Record<SuspensionRisk, StatusTone> = {
  high: "attention",
  medium: "info",
  low: "positive",
  out_of_scope: "neutral",
  unknown: "neutral",
};

const DECISIONS = ["pending", "file", "hold"] as const;
const DECISION_KEY: Record<(typeof DECISIONS)[number], string> = {
  pending: "case-suspension-decision-pending",
  file: "case-suspension-decision-file",
  hold: "case-suspension-decision-hold",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents: number) => BRL.format(cents / 100);

/**
 * How this case goes to court, as the rules of the domain answer it
 * (`@flyee/rules`): which lawsuits it becomes and in which court, by who
 * claims and how much; and how the national suspension of Tema 1.417 weighs
 * on it, from what the airline said and the weather kept for the trip.
 *
 * Somebody who plans the filing comes here to settle what the rules leave
 * to the firm: how a family goes to court (together, unless a lawyer splits
 * it), create the lawsuits the rule plans, each claimant's word on the civil
 * court, and whether to file now or hold. The rule
 * answers and names its grounds; the decision is the person's, recorded
 * under their name. Nothing here is the AI's.
 */
export default function RulesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const { rules } = state;
  const claimants = state.parties.filter((party) => party.role === "claimant");
  // 3.3: the priority of an elderly claimant, by the birth date on record (`especificidades-v1`), which the piece asks.
  const priority = specificitiesOf(
    claimants.map((party) => ({ name: party.person.full_name, birthDate: party.person.birth_date })),
    state.today,
  );

  const [claims, setClaims] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      claimants.map((party) => {
        const cents = rules.claims[party.partyId];
        return [party.partyId, cents ? (cents / 100).toFixed(2) : ""];
      }),
    ),
  );
  // What the person touched, and nothing else: an untouched field shows (and keeps) what the case has now,
  // so a screen opened earlier never sends back a colleague's older cause or decision.
  const [touchedCause, setTouchedCause] = useState<string | null>(null);
  const [touchedDecision, setTouchedDecision] = useState<(typeof DECISIONS)[number] | null>(null);
  const cause = touchedCause ?? rules.statedCause ?? "";
  const decision = touchedDecision ?? rules.decision;
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("rules");
  const [problem, setProblem] = useState<string | null>(null);

  const centsOf = (partyId: string): number | null => {
    const value = Number(claims[partyId]);
    return claims[partyId] !== "" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  };

  // The parties as the rules read them, the same way the server does (a minor by the birth date, or by a
  // guardian while none is written; the domicile of each lawsuit's own claimants).
  const parties = ruleParties(state.parties, rules.claims);
  // The firm's Valor da Causa Pedido for the case's kind of problem is written for a claimant with none when the
  // lawsuits are created, by ONE or here; once they are, a blank value goes with none, for the judge to define.
  const claimDefault = state.proceedings.length === 0 ? rules.claimDefault : null;
  // The plan as the rule gives it for what is on screen: a typed value moves a claimant at once, and a blank one
  // asks what the lawsuits would be created with.
  const plan = rules.ceiling
    ? planProceedings({
        ceilingCents: rules.ceiling.cents,
        familyChoice: rules.family.choice,
        claimants: parties
          .filter((party) => party.role === "claimant")
          .map((party) => ({
            partyId: party.partyId,
            minor: isMinorParty(party, state.today),
            claimCents: centsOf(party.partyId) ?? claimDefault,
          })),
      })
    : null;
  const nameOf = (partyId: string) => claimants.find((party) => party.partyId === partyId)?.person.full_name ?? "";
  const forumOf = (partyIds: string[]) => caseDomicile(parties, state.today, partyIds);
  // The lawsuits are created from what is saved: a value typed and not saved yet would plan another thing.
  const unsavedClaim = claimants.some((party) => centsOf(party.partyId) !== (rules.claims[party.partyId] ?? null));
  const everyForumKnown =
    plan !== null && plan.proceedings.every((proceeding) => forumOf(proceeding.partyIds) !== null);

  // The triage for what is selected, on the weather already kept.
  const triage = triageSuspension({
    incident: state.case.incident ?? "other",
    statedCause: (STATED_CAUSES as readonly string[]).includes(cause) ? (cause as StatedCause) : null,
    weatherSigns: rules.weather.signs,
  });

  // What came of each action is said in the card by the case screen, with the time, once the screen shows it.
  const run = (key: string, work: () => Promise<{ ok: boolean; code: string }>, words: CaseActionWords) =>
    action.run(key, words, async () => {
      setProblem(null);
      const result = await work();
      if (!result.ok) setProblem(result.code);
      return result.ok;
    });
  const words = {
    claim: { doing: t("case-action-claim-doing"), done: t("case-action-claim-done") },
    plan: {
      doing: t("case-action-plan-doing"),
      done: t("case-plan-created"),
      failed: t("case-action-plan-failed"),
      target: "proceedings",
    },
    weather: {
      doing: t("case-action-weather-doing"),
      done: t("case-suspension-weather-done"),
      failed: t("case-action-weather-failed"),
    },
    suspension: {
      doing: t("case-action-suspension-doing"),
      done: t("case-suspension-saved"),
      failed: t("case-action-suspension-failed"),
    },
  } satisfies Record<string, CaseActionWords>;

  const signWords = (signs: string[]) =>
    signs.length === 0
      ? t("case-suspension-weather-clear")
      : signs.map((sign) => (sign in SIGN_KEY ? t(SIGN_KEY[sign as WeatherSign]) : sign)).join(", ");

  // What the rule plans and what the firm decided on the suspension, in one line; and what keeps the plan from
  // standing: a claimant who said no to the civil court. A claimant with no Valor da Causa Pedido is no such thing:
  // the lawsuit goes with no value, and the judge defines it (0064).
  const civilDeclined = state.civilCourt.some((need) => need.accepted === false);
  const planned = plan ? [...new Set(plan.proceedings.map((proceeding) => t(KIND_KEY[proceeding.kind])))] : [];
  // In the drafting the card is where the lawsuits are created: once they are, the case goes on in their cards.
  const toCreate = state.case.status === "drafting" && state.proceedings.length === 0;

  return (
    <CollapsibleCard
      id="case-rules"
      anchor="como-vai-a-juizo"
      title={t("case-rules-title")}
      summary={[
        planned.join(", ") || null,
        t("case-rules-summary-suspension", { decision: t(DECISION_KEY[rules.decision]) }),
      ]
        .filter(Boolean)
        .join(" · ")}
      ask={civilDeclined ? { tone: "firm", label: t("case-rules-summary-civil-declined") } : null}
      description={t("case-rules-body")}
      defaultOpen={opensOnArrival(state.case.status, "rules", civilDeclined || toCreate)}
      bodyClassName="gap-5"
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}
      <QualificationBlock
        caseId={state.case.id}
        qualification={state.case.qualification}
        mayRelease={writable && state.lawyer && !state.supportVisit}
        onChanged={onChanged}
      />
      {priority.priority !== "none" && (
        <StateLine tone="info">
          {t(priority.priority === "elderly_80" ? "case-priority-special" : "case-priority-elderly", {
            people: priority.people.map((person) => t("case-priority-person", person)).join(", "),
          })}
        </StateLine>
      )}

      <Box className="flex flex-col gap-3">
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t("case-plan-title")}
        </Typography>
        {claimants.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-plan-empty")}
          </Typography>
        ) : (
          <>
            {plan?.proceedings.map((proceeding) => (
              <Box key={proceeding.kind} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
                <Box>
                  <StatusChip
                    tone={proceeding.kind === "juizado" ? "primary" : "info"}
                    label={t(KIND_KEY[proceeding.kind])}
                  />
                </Box>
                <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                  {proceeding.partyIds.map((partyId) => (
                    <Typography component="li" variant="body1" key={partyId}>
                      {t("case-plan-claimant", {
                        name: nameOf(partyId),
                        reason: t(PLAN_REASON_KEY[proceeding.reasons[partyId]]),
                      })}
                    </Typography>
                  ))}
                </Box>
                {forumOf(proceeding.partyIds) ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("case-plan-forum", {
                      city: forumOf(proceeding.partyIds)?.city ?? "",
                      uf: forumOf(proceeding.partyIds)?.uf ?? "",
                    })}
                  </Typography>
                ) : (
                  // The domicile decides the forum and lives in the people's card (`WAIT_PLACE.domicile_unknown`).
                  <StateLine
                    tone="attention"
                    action={
                      writable ? (
                        <Button variant="outlined" color="grey" size="small" href="#case-people">
                          {t("case-plan-no-domicile-fix")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {t("case-plan-no-domicile")}
                  </StateLine>
                )}
              </Box>
            ))}
            {plan && <FamilyPlanBox state={state} family={plan.family} writable={writable} onChanged={onChanged} />}
            <Typography variant="body2" className="text-text-secondary">
              {rules.ceiling
                ? t("case-plan-ceiling", {
                    ceiling: money(rules.ceiling.cents),
                    times: rules.ceiling.times,
                    wage: money(rules.ceiling.minimumWage.cents),
                    act: rules.ceiling.minimumWage.act,
                  })
                : t("case-plan-ceiling-unknown")}
            </Typography>
            {plan && plan.claimUnknown.length > 0 && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-plan-claim-unknown")}
              </Typography>
            )}

            {writable && (
              <Box className="flex flex-col gap-2">
                {claimants.map((party) => (
                  <Box key={party.partyId} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <CurrencyField
                      size="small"
                      className="sm:max-w-xs"
                      fullWidth
                      id={`case-claim-${party.partyId}`}
                      name={`claim-${party.partyId}`}
                      label={t("case-plan-claim-label", { name: party.person.full_name })}
                      currencySymbol="R$"
                      value={claims[party.partyId] ?? ""}
                      disabled={action.busy}
                      onChange={(event) =>
                        setClaims((current) => ({ ...current, [party.partyId]: event.target.value }))
                      }
                    />
                    <Box>
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={action.busy || centsOf(party.partyId) === (rules.claims[party.partyId] ?? null)}
                        loading={action.pending(`claim-${party.partyId}`)}
                        loadingPosition="start"
                        onClick={() =>
                          void run(
                            `claim-${party.partyId}`,
                            () => setPartyClaim(state.case.id, party.partyId, centsOf(party.partyId)),
                            words.claim,
                          )
                        }
                      >
                        {action.pending(`claim-${party.partyId}`)
                          ? sentence(words.claim.doing)
                          : t("case-plan-claim-save")}
                      </Button>
                    </Box>
                  </Box>
                ))}
                <Typography variant="body2" className="text-text-secondary">
                  {claimDefault !== null
                    ? t("case-plan-claim-default", {
                        kind: t(caseKindLabelKey(state.case.incident) ?? "case-incident-other"),
                        value: money(claimDefault),
                      })
                    : t("case-plan-claim-judge")}
                </Typography>
              </Box>
            )}

            {state.proceedings.length > 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-plan-exists")}
              </Typography>
            ) : writable && plan && plan.proceedings.length > 0 ? (
              <Box className="flex flex-col gap-1">
                <Box>
                  <Button
                    variant="contained"
                    disabled={action.busy || unsavedClaim || !everyForumKnown}
                    loading={action.pending("plan")}
                    loadingPosition="start"
                    onClick={() =>
                      void run("plan", () => createPlannedProceedings(state.case.id, rules.family.choice), words.plan)
                    }
                  >
                    {action.pending("plan") ? sentence(words.plan.doing) : t("case-plan-create")}
                  </Button>
                </Box>
                {unsavedClaim && (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("case-plan-unsaved")}
                  </Typography>
                )}
              </Box>
            ) : null}
          </>
        )}
      </Box>

      <CivilCourtAnswers state={state} writable={writable} onChanged={onChanged} />
      {/* The answers of the start of a lawsuit of the civil court; those of a recurso are on its judgment (0218). */}
      <FreeJusticeAnswers
        caseId={state.case.id}
        needs={state.freeJustice ? state.freeJustice.filter((need) => !need.appeal) : null}
        writable={writable}
        onChanged={onChanged}
      />

      <Box className="border-grey-100 flex flex-col gap-3 border-t pt-5">
        <SectionTitle
          id="case-suspension-title"
          as="h3"
          variant="subtitle2"
          title={t("case-suspension-title")}
          description={t("case-suspension-body")}
        />

        <TextField
          select
          size="small"
          className="sm:max-w-md"
          fullWidth
          id="case-stated-cause"
          label={t("case-suspension-cause-label")}
          value={cause}
          disabled={!writable || action.busy}
          onChange={(event) => setTouchedCause(event.target.value)}
        >
          <MenuItem value="">{t("case-field-choose")}</MenuItem>
          {STATED_CAUSES.map((value) => (
            <MenuItem key={value} value={value}>
              {t(STATED_CAUSE_KEY[value])}
            </MenuItem>
          ))}
        </TextField>

        <Box className="flex flex-col gap-2">
          {rules.weather.readAt === null ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("case-suspension-weather-none")}
            </Typography>
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
              {rules.weather.airports.map((airport) => (
                <Typography component="li" variant="body1" key={airport.iata}>
                  {airport.state === "uncovered"
                    ? t("case-suspension-weather-uncovered", { airport: airport.iata })
                    : airport.state === "no_hour"
                      ? t("case-suspension-weather-no-hour", { airport: airport.iata })
                      : airport.state === "stale"
                        ? t("case-suspension-weather-stale", { airport: airport.iata })
                        : airport.count === 0
                          ? t("case-suspension-weather-empty", { airport: airport.iata })
                          : t("case-suspension-weather-line", {
                              icao: airport.iata,
                              count: airport.count,
                              signs: signWords(airport.signs),
                            })}
                </Typography>
              ))}
            </Box>
          )}
          {writable && (
            <Box className="flex flex-col gap-1">
              <Box>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={action.busy || !rules.weatherConfigured}
                  loading={action.pending("weather")}
                  loadingPosition="start"
                  onClick={() => void run("weather", () => readCaseWeather(state.case.id), words.weather)}
                >
                  {action.pending("weather") ? sentence(words.weather.doing) : t("case-suspension-weather-read")}
                </Button>
              </Box>
              {!rules.weatherConfigured && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-suspension-weather-off")}
                </Typography>
              )}
            </Box>
          )}
        </Box>

        <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
          <Box className="flex flex-wrap items-center gap-2">
            <Typography variant="body1" className="font-semibold">
              {t("case-suspension-risk-label")}
            </Typography>
            <StatusChip tone={RISK_TONE[triage.risk]} label={t(RISK_KEY[triage.risk])} />
          </Box>
          <Box component="ul" className="text-text-primary m-0 flex list-disc flex-col gap-1 pl-5">
            {triage.grounds.map((ground) => (
              <Typography component="li" variant="body2" key={ground}>
                {t(GROUND_KEY[ground])}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {t("case-suspension-risk-note")}
          </Typography>
        </Box>

        <RadioGroup
          aria-label={t("case-suspension-decision-label")}
          value={decision}
          onChange={(event) => setTouchedDecision(event.target.value as (typeof DECISIONS)[number])}
        >
          {DECISIONS.map((value) => (
            <FormControlLabel
              key={value}
              value={value}
              disabled={!writable || !state.lawyer || action.busy}
              control={<Radio size="small" />}
              label={t(DECISION_KEY[value])}
            />
          ))}
        </RadioGroup>
        {rules.decisionAuto && rules.decision !== "pending" ? (
          <Typography variant="body2" className="text-text-secondary">
            {t(state.lawyer ? "case-suspension-decided-auto-lawyer" : "case-suspension-decided-auto")}
          </Typography>
        ) : !state.lawyer ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-suspension-decision-who")}
          </Typography>
        ) : null}
        {writable && (
          <Box>
            <Button
              variant="contained"
              disabled={
                action.busy ||
                (cause === (rules.statedCause ?? "") &&
                  decision === rules.decision &&
                  // A lawyer makes ONE's decision their own by saving it as it is.
                  !(rules.decisionAuto && state.lawyer))
              }
              onClick={() =>
                void run(
                  "suspension",
                  // The decision goes only when this person chose one: a screen opened earlier never undoes a colleague's.
                  async () => {
                    const result = await saveSuspension(state.case.id, {
                      statedCause: cause || null,
                      decision:
                        touchedDecision !== null && touchedDecision !== rules.decision
                          ? touchedDecision
                          : // Saved as it is by a lawyer, ONE's decision becomes theirs.
                            rules.decisionAuto && state.lawyer
                            ? decision
                            : null,
                    });
                    if (result.ok) {
                      setTouchedCause(null);
                      setTouchedDecision(null);
                    }
                    return result;
                  },
                  words.suspension,
                )
              }
              loading={action.pending("suspension")}
              loadingPosition="start"
            >
              {action.pending("suspension") ? sentence(words.suspension.doing) : t("case-suspension-save")}
            </Button>
          </Box>
        )}
      </Box>
    </CollapsibleCard>
  );
}
