"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import StateLine from "@/components/product/state-line";
import { answerClientComplaint, recordClientComplaint } from "@/lib/cases/client-link-actions";
import { CONSUMIDOR_GOV_URL, type PriorComplaint, priorComplaintErrorKey } from "@/lib/cases/prior-complaint";

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const brDay = (day: string | null) => (day ? day.split("-").reverse().join("/") : "");

/**
 * The complaint before the lawsuit, where the unit of the client's lawsuit asks it (migration 0180): ONE files
 * nothing at the channel, so the page guides the client step by step at consumidor.gov.br and takes the protocol they
 * got; then it says until when the airline has to answer and asks what it answered. Shown whatever the stage of the
 * case: the complaint is asked after the lawsuits exist, when the unit is known.
 */
export default function ClientPriorComplaint({
  token,
  view,
  onSaved,
}: {
  token: string;
  view: PriorComplaint | null;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [protocol, setProtocol] = useState("");
  const [filedOn, setFiledOn] = useState(todayInBrazil);
  const [outcome, setOutcome] = useState<"answered" | "settled" | "">("");
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!view || view.state === "not_required") return null;
  const airline = view.airline ?? t("client-prior-complaint-airline-fallback");
  const complaint = view.complaint;

  const run = async (write: () => Promise<{ ok: boolean; code: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await write();
      if (result.ok) onSaved();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  const sendProtocol = () => {
    if (protocol.trim().length < 3) return setProblem("invalid_protocol");
    void run(() => recordClientComplaint(token, protocol, filedOn));
  };

  const sendAnswer = () => {
    if (!outcome) return setProblem("invalid_outcome");
    const value = paid.trim() === "" ? null : Math.round(Number(paid) * 100);
    if (value !== null && !Number.isFinite(value)) return setProblem("invalid_value");
    void run(() => answerClientComplaint(token, outcome, outcome === "settled" ? value : null));
  };

  return (
    <Card component="section" aria-labelledby="prior-complaint-title">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="prior-complaint-title" variant="h6" component="h2" className="mb-0">
            {t("client-prior-complaint-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-prior-complaint-body", { airline })}
          </Typography>
        </Box>

        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(priorComplaintErrorKey(problem))}
          </Alert>
        ) : null}

        {view.state === "owed" ? (
          <Box
            component="form"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              sendProtocol();
            }}
          >
            <Box component="ol" className="m-0 flex list-decimal flex-col gap-2 pl-5">
              <Typography component="li" variant="body2">
                {t.rich("client-prior-complaint-step-1", {
                  site: (chunks) => (
                    <Link href={CONSUMIDOR_GOV_URL} target="_blank" rel="noreferrer noopener">
                      {chunks}
                    </Link>
                  ),
                })}
              </Typography>
              <Typography component="li" variant="body2">
                {t("client-prior-complaint-step-2", { airline })}
              </Typography>
              <Typography component="li" variant="body2">
                {t("client-prior-complaint-step-3")}
              </Typography>
              <Typography component="li" variant="body2">
                {t("client-prior-complaint-step-4")}
              </Typography>
            </Box>
            <TextField
              label={t("client-prior-complaint-protocol")}
              value={protocol}
              onChange={(event) => setProtocol(event.target.value)}
              helperText={t("client-prior-complaint-protocol-help")}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              type="date"
              label={t("client-prior-complaint-filed-on")}
              value={filedOn}
              onChange={(event) => setFiledOn(event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayInBrazil() } }}
            />
            <Box>
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? t("client-prior-complaint-sending") : t("client-prior-complaint-send")}
              </Button>
            </Box>
          </Box>
        ) : null}

        {view.state === "waiting" && complaint ? (
          <Box className="flex flex-col gap-4">
            <StateLine tone="waiting">
              {t("client-prior-complaint-waiting", {
                protocol: complaint.protocol ?? "",
                due: brDay(complaint.dueOn),
              })}
            </StateLine>
            <Box
              component="form"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                sendAnswer();
              }}
            >
              <FormControl component="fieldset">
                <FormLabel component="legend" id="prior-complaint-answer" className="mb-1">
                  {t("client-prior-complaint-answer-question", { airline })}
                </FormLabel>
                <RadioGroup
                  aria-labelledby="prior-complaint-answer"
                  name="prior-complaint-answer"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value as "answered" | "settled")}
                >
                  <FormControlLabel
                    value="settled"
                    control={<Radio />}
                    label={t("client-prior-complaint-answer-settled")}
                  />
                  <FormControlLabel
                    value="answered"
                    control={<Radio />}
                    label={t("client-prior-complaint-answer-answered")}
                  />
                </RadioGroup>
              </FormControl>
              {outcome === "settled" ? (
                <CurrencyField
                  fullWidth
                  className="sm:max-w-xs"
                  id="prior-complaint-paid"
                  name="prior-complaint-paid"
                  label={t("client-prior-complaint-paid")}
                  helperText={t("client-prior-complaint-paid-help")}
                  currencySymbol="R$"
                  value={paid}
                  onChange={(event) => setPaid(event.target.value)}
                />
              ) : null}
              <Box>
                <Button type="submit" variant="outlined" color="grey" disabled={busy || !outcome}>
                  {busy ? t("client-prior-complaint-sending") : t("client-prior-complaint-answer-send")}
                </Button>
              </Box>
            </Box>
          </Box>
        ) : null}

        {view.state === "done" && complaint ? (
          <StateLine tone="done">
            {complaint.outcome === "settled"
              ? t("client-prior-complaint-done-settled")
              : complaint.outcome === "no_answer" || view.overdue
                ? t("client-prior-complaint-done-unanswered")
                : t("client-prior-complaint-done-answered")}
          </StateLine>
        ) : null}
      </CardContent>
    </Card>
  );
}
