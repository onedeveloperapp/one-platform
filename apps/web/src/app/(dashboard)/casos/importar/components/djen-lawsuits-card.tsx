"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Skeleton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import { CpfField } from "@/components/product/fields";
import StateLine from "@/components/product/state-line";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import { writeWorkbook } from "@/lib/export/xlsx-write";
import { askDjenCases, completeDjenClient, readFirmDjenCases, readFirmDjenLawsuits } from "@/lib/import/djen-actions";
import { type DjenCases, type DjenClient, skipReasonKey } from "@/lib/import/djen-cases";
import { cnjMasked, type DjenLawsuit, djenLawsuitsSheet, lawsuitsToComplete } from "@/lib/import/djen-lawsuits";
import { isValidCpf, onlyDigits } from "@flyee/fields";

type Read = { total: number; lawsuits: DjenLawsuit[]; cases: DjenCases };

/**
 * The lawsuits the DJEN already shows of the firm's lawyers (migrations 0208 and 0287), in the order of who owes what:
 * the CPF of each client ONE named (only the firm has it), the lawsuits that wait for a person to let ONE open them
 * (a firm that keeps that decision), then ONE's work (the cases it opened, the ones it is reading) and what it left
 * with why, and the spreadsheet of what ONE does not open, which the import below reads back.
 */
export default function DjenLawsuitsCard() {
  const t = useTranslations("product");
  // undefined while it is read; null where the person may not bring lawsuits in (the card is not theirs); "failed"
  // when the read failed, said with the way to try again.
  const [read, setRead] = useState<Read | null | "failed" | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [askProblem, setAskProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState<number | null>(null);

  const load = () => {
    setRead(undefined);
    void Promise.all([readFirmDjenLawsuits(), readFirmDjenCases()])
      .then(([lawsuits, cases]) => {
        const refused = (code: string) => code === "not_allowed" || code === "support_visit";
        if ((!lawsuits.ok && refused(lawsuits.code)) || (!cases.ok && refused(cases.code))) setRead(null);
        else if (!lawsuits.ok || !cases.ok) setRead("failed");
        else setRead({ total: lawsuits.total, lawsuits: lawsuits.lawsuits, cases: cases.cases });
      })
      .catch(() => setRead("failed"));
  };

  useEffect(() => {
    load();
  }, []);

  const toComplete = read && read !== "failed" ? lawsuitsToComplete(read.lawsuits) : [];

  const download = () => {
    if (toComplete.length === 0) return;
    const bytes = writeWorkbook([djenLawsuitsSheet(toComplete)]);
    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "processos-do-djen.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  };

  // A CPF given takes its client off the list in place: what is typed in the other lines is never lost to a reload.
  const given = (personId: string) =>
    setRead((current) =>
      current && current !== "failed"
        ? {
            ...current,
            cases: {
              ...current.cases,
              withoutCpf: current.cases.withoutCpf.filter((client) => client.personId !== personId),
              withoutCpfTotal: Math.max(current.cases.withoutCpfTotal - 1, 0),
            },
          }
        : current,
    );

  const ask = async () => {
    setAsking(true);
    setAskProblem(null);
    const answer = await askDjenCases().catch(() => ({ ok: false as const, code: "failed" }));
    setAsking(false);
    if (!answer.ok) {
      setAskProblem(answer.code === "second_factor" ? "import-djen-ask-second-factor" : "import-djen-ask-failed");
      return;
    }
    setAsked(answer.lawsuits);
    load();
  };

  if (read === null) return null;

  const cases = read && read !== "failed" ? read.cases : null;
  const skippedTotal = cases ? cases.skipped.reduce((sum, row) => sum + row.count, 0) : 0;
  const nothing =
    read &&
    read !== "failed" &&
    read.total === 0 &&
    cases !== null &&
    cases.opened === 0 &&
    cases.opening === 0 &&
    cases.withoutCpfTotal === 0;

  return (
    <Card component="section" aria-labelledby="import-djen-title" className="mx-auto w-full max-w-2xl">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="import-djen-title"
          icon={<NiDocumentCheck size="medium" />}
          title={t("import-djen-title")}
          description={t("import-djen-hint")}
        />
        {read === undefined ? (
          <Skeleton variant="rounded" height={56} />
        ) : read === "failed" || cases === null ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={load}>
                {t("cases-retry")}
              </Button>
            }
          >
            {t("import-djen-failed")}
          </Alert>
        ) : nothing ? (
          <StateLine tone="info">{t("import-djen-none")}</StateLine>
        ) : (
          <>
            {/* What only the firm gives: the CPF of each client ONE named. */}
            {cases.withoutCpfTotal > 0 ? (
              <Box className="flex flex-col gap-3">
                <StateLine tone="attention">{t("import-djen-cpf-owed", { count: cases.withoutCpfTotal })}</StateLine>
                <Box className="flex flex-col gap-2">
                  {cases.withoutCpf.map((client) => (
                    <ClientCpf key={client.personId} client={client} onSaved={() => given(client.personId)} />
                  ))}
                </Box>
                {cases.withoutCpfTotal > cases.withoutCpf.length ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("import-djen-cpf-more", { shown: cases.withoutCpf.length })}
                  </Typography>
                ) : null}
              </Box>
            ) : null}

            {/* A firm that keeps the opening of these cases with a person: the person's decision, in place. */}
            {cases.mode === "approval" && cases.module && cases.waiting > 0 ? (
              <StateLine
                tone="attention"
                action={
                  <Button variant="contained" size="small" disabled={asking} onClick={() => void ask()}>
                    {asking ? t("import-djen-asking") : t("import-djen-ask")}
                  </Button>
                }
              >
                {t("import-djen-waiting", { count: cases.waiting })}
              </StateLine>
            ) : null}
            {askProblem ? (
              <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setAskProblem(null)}>
                {t(askProblem)}
              </Alert>
            ) : null}
            {asked !== null ? <StateLine tone="done">{t("import-djen-asked", { count: asked })}</StateLine> : null}

            {/* ONE's work: done, and being done. */}
            {cases.opened > 0 ? (
              <StateLine
                tone="done"
                action={
                  <Button variant="text" size="small" href="/casos" LinkComponent={Link}>
                    {t("import-djen-opened-see")}
                  </Button>
                }
              >
                {t("import-djen-opened", { count: cases.opened })}
              </StateLine>
            ) : null}
            {cases.opening > 0 ? (
              <StateLine tone="waiting">{t("import-djen-opening", { count: cases.opening })}</StateLine>
            ) : null}
            {skippedTotal > 0 ? (
              <Box className="flex flex-col gap-1">
                <StateLine tone="info">{t("import-djen-skipped", { count: skippedTotal })}</StateLine>
                <Box component="ul" className="text-text-secondary m-0 flex list-none flex-col gap-0.5 ps-9">
                  {cases.skipped.map((row) => (
                    <Typography key={row.reason} component="li" variant="body2">
                      {t(skipReasonKey(row.reason), { count: row.count })}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ) : null}

            {/* What ONE does not open: the spreadsheet the import below reads back. */}
            {toComplete.length > 0 ? (
              <StateLine
                tone="info"
                action={
                  <Button variant="outlined" size="small" onClick={download}>
                    {t("import-djen-download")}
                  </Button>
                }
              >
                {t("import-djen-found", { count: toComplete.length })}
              </StateLine>
            ) : null}
            {read.total > read.lawsuits.length ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("import-djen-partial", { shown: read.lawsuits.length })}
              </Typography>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One client ONE named, with the field of their CPF and its one button; what came of it is said in the line. */
function ClientCpf({ client, onSaved }: { client: DjenClient; onSaved: () => void }) {
  const t = useTranslations("product");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const digits = onlyDigits(value);
  const ready = digits.length === 11 && isValidCpf(digits);

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setProblem(null);
    const answer = await completeDjenClient(client.personId, digits).catch(() => ({
      ok: false as const,
      code: "failed",
    }));
    setSaving(false);
    if (!answer.ok) {
      setProblem(
        answer.code === "cpf_other_name"
          ? "import-djen-cpf-other-name"
          : answer.code === "invalid_cpf"
            ? "psc-action-invalid-cpf"
            : "import-djen-cpf-failed",
      );
      return;
    }
    onSaved();
  };

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between">
      <Box className="flex min-w-0 flex-col">
        <Typography variant="body2" className="font-semibold">
          {client.name}
        </Typography>
        <Typography variant="caption" className="text-text-secondary">
          <Link href={`/casos/${client.caseId}`} className="text-inherit">
            {t("import-djen-cpf-case", { seq: client.seq })}
          </Link>
          {` · ${cnjMasked(client.cnj)}`}
        </Typography>
      </Box>
      <Box className="flex items-start gap-2">
        <CpfField
          size="small"
          className="w-44"
          label={t("psc-cpf-label")}
          value={value}
          disabled={saving}
          invalidMessage={t("psc-action-invalid-cpf")}
          error={Boolean(problem)}
          helperText={problem ? t(problem) : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          variant="outlined"
          size="small"
          disabled={!ready || saving}
          onClick={() => void save()}
          className="mt-0.5"
        >
          {saving ? t("import-djen-cpf-saving") : t("import-djen-cpf-save")}
        </Button>
      </Box>
    </Box>
  );
}
