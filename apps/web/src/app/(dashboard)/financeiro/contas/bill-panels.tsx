"use client";

import type { FinanceRegistrations } from "../load-finance";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import { CurrencyField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiMoney from "@/icons/nexture/ni-money";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { renegotiateFinanceBill, saveFinanceBill, settleFinanceBill, splitFinancePayment } from "@/lib/finance/actions";
import { type BillDirection, billRest, contractSplit, type FinanceBill } from "@/lib/finance/bills";
import { financeErrorKey, financeFieldKey, money } from "@/lib/finance/books";
import { dropUnsavedFinance, sendFinanceDocument } from "@/lib/finance/document-browser";
import { FINANCE_DOCUMENT_KIND_KEY, type FinanceDocumentRead } from "@/lib/finance/documents";
import { readBoleto } from "@flyee/rules/boleto";
import { formatCents, parseCents } from "@flyee/rules/finance";

const NEW_KEY: Record<BillDirection, string> = { pay: "finance-bill-new-pay", receive: "finance-bill-new-receive" };
const SLOT_KEY: Record<BillDirection, string> = { pay: "finance-doc-slot-pay", receive: "finance-doc-slot-receive" };
const SETTLE_KEY: Record<BillDirection, string> = {
  pay: "finance-bill-settle-pay",
  receive: "finance-bill-settle-receive",
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const centsText = (cents: number) => formatCents(cents).replace(/^-?R\$\s/, "");

/** Why ONE could not read a document of the books, as the slot says it; the form stays to be filled by hand. */
const DOCUMENT_FAILED_KEY: Record<string, string> = {
  document_limit: "finance-doc-failed-limit",
  unsupported_type: "finance-doc-failed-type",
  type_not_allowed: "finance-doc-failed-type",
  image_unreadable: "finance-doc-failed-image",
  too_large: "finance-doc-failed-large",
  not_allowed: "finance-doc-failed-not-allowed",
  second_factor: "finance-doc-failed-second-factor",
};
export const documentFailedKey = (code: string) => DOCUMENT_FAILED_KEY[code] ?? "finance-doc-failed-generic";

/** What ONE read of a document, in one sentence for its slot: what it is, that ONE may err, and what to look at. */
export function useDocumentSentence() {
  const t = useTranslations("product");
  return (
    read: FinanceDocumentRead,
    target: "bill" | "entry" = "bill",
  ): { tone: "positive" | "attention"; sentence: string } => {
    const kind = t(FINANCE_DOCUMENT_KIND_KEY[read.kind]);
    const parts = [
      target === "entry" ? t("finance-doc-read-sentence-entry", { kind }) : t("finance-doc-read-sentence", { kind }),
    ];
    if (read.valueFromLine) parts.push(t("finance-doc-value-from-line"));
    if (read.lineFailed) parts.push(t("finance-doc-line-failed"));
    if (!read.legible) parts.push(t("finance-doc-not-legible"));
    if (read.notes) parts.push(read.notes);
    const doubtful = !read.legible || read.kind === "outro" || read.lineFailed || read.cents === null;
    return { tone: doubtful ? "attention" : "positive", sentence: parts.join(" ") };
  };
}

/** The refusal of a write, with the field it names, as the panels say it. */
function Problem({ problem }: { problem: { code: string; field?: string } | null }) {
  const t = useTranslations("product");
  if (!problem) return null;
  return (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {t(financeErrorKey(problem.code))}
      {financeFieldKey(problem.field) ? ` ${t(financeFieldKey(problem.field) as string)}` : ""}
    </Alert>
  );
}

/**
 * A new bill to pay or to receive, or one still open with nothing paid (migration 0129). The typed line comes first:
 * the rule checks every digit and fills the value and the due day it says; the rest is the person's (who, the
 * category, the month it belongs to, how many months it repeats).
 */
export function BillPanel({
  direction,
  bill,
  registrations,
  onClose,
  onSaved,
}: {
  direction: BillDirection;
  bill: FinanceBill | null;
  registrations: FinanceRegistrations;
  onClose: () => void;
  onSaved: (months: number) => void;
}) {
  const t = useTranslations("product");
  const categories = useMemo(
    () =>
      registrations.categories.filter(
        (category) =>
          !category.archived &&
          (direction === "pay"
            ? ["expense", "partner_out", "client_money"].includes(category.kind)
            : ["income", "partner_in", "client_money"].includes(category.kind)),
      ),
    [registrations.categories, direction],
  );
  const centers = registrations.costCenters.filter((center) => !center.archived);
  const [typed, setTyped] = useState(bill?.typedLine ?? "");
  const [barcode, setBarcode] = useState<string | null>(null);
  const [lineNote, setLineNote] = useState<{ tone: "done" | "failed"; text: string } | null>(null);
  const [counterparty, setCounterparty] = useState(bill?.counterparty ?? "");
  const [description, setDescription] = useState(bill?.description ?? "");
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? categories[0]?.id ?? "");
  const [centerId, setCenterId] = useState("");
  const [value, setValue] = useState(bill ? centsText(bill.cents) : "");
  const [dueOn, setDueOn] = useState(bill?.dueOn ?? today());
  const [competence, setCompetence] = useState(bill?.competenceOn.slice(0, 7) ?? today().slice(0, 7));
  const [repeat, setRepeat] = useState("1");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  // A new bill starts from its document (0140); the typed line and the fields by hand are the other ways in.
  const [stage, setStage] = useState<"start" | "form">(bill ? "form" : "start");
  const [slot, setSlot] = useState<SlotState>({ kind: "empty" });
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readFields, setReadFields] = useState<Record<string, string>>({});
  const documentSentence = useDocumentSentence();
  const readHelp = (field: string, current: string) =>
    readFields[field] !== undefined && readFields[field] === current ? t("finance-doc-field-read") : undefined;

  const close = () => {
    dropUnsavedFinance([fileId]);
    onClose();
  };

  const sendDocument = async (file: File) => {
    dropUnsavedFinance([fileId]);
    setFileId(null);
    setFileName(file.name);
    setSlot({ kind: "sending" });
    setProblem(null);
    const sent = await sendFinanceDocument(file, { direction, target: "bill" });
    setFileId(sent.fileId);
    if (!sent.ok) {
      setSlot({ kind: "failed", sentence: t(documentFailedKey(sent.code)) });
      setStage("form");
      return;
    }
    const read = sent.read;
    const filled: Record<string, string> = {};
    if (read.counterparty) {
      setCounterparty(read.counterparty);
      filled.counterparty = read.counterparty;
    }
    if (read.description) {
      setDescription(read.description);
      filled.description = read.description;
    }
    if (read.categoryId && categories.some((category) => category.id === read.categoryId)) {
      setCategoryId(read.categoryId);
      filled.category = read.categoryId;
    }
    if (read.typedLine || read.barcode) readLine(read.typedLine ?? read.barcode ?? "");
    if (read.cents) {
      setValue(centsText(read.cents));
      filled.value = centsText(read.cents);
    }
    if (read.dueOn) {
      setDueOn(read.dueOn);
      filled.due = read.dueOn;
    }
    const month = read.competence ?? read.dueOn?.slice(0, 7) ?? null;
    if (month) {
      setCompetence(month);
      filled.competence = month;
    }
    setReadFields(filled);
    setSlot({ kind: "read", ...documentSentence(read) });
    setStage("form");
  };

  const readLine = (text: string) => {
    setTyped(text);
    const digits = text.replace(/\D/g, "");
    if (digits.length < 44) {
      setLineNote(null);
      setBarcode(null);
      return;
    }
    const read = readBoleto(digits, today());
    if (!read.ok) {
      setBarcode(null);
      setLineNote({ tone: "failed", text: t("finance-bill-line-wrong") });
      return;
    }
    setStage("form");
    setBarcode(read.boleto.barcode);
    if (read.boleto.cents) setValue(centsText(read.boleto.cents));
    if (read.boleto.dueOn) {
      setDueOn(read.boleto.dueOn);
      setCompetence(read.boleto.dueOn.slice(0, 7));
    }
    const day = read.boleto.dueOn ? read.boleto.dueOn.split("-").reverse().join("/") : null;
    const cents = read.boleto.cents;
    setLineNote({
      tone: "done",
      text:
        cents && day
          ? t("finance-bill-line-read", { value: money(cents), day })
          : cents
            ? t("finance-bill-line-read-no-day", { value: money(cents) })
            : day
              ? t("finance-bill-line-read-no-value", { day })
              : t("finance-bill-line-read-nothing"),
    });
  };

  const save = async () => {
    const cents = parseCents(value);
    if (!cents || cents <= 0) return setProblem({ code: "invalid_data", field: "cents" });
    setBusy(true);
    setProblem(null);
    try {
      const digits = typed.replace(/\D/g, "");
      const result = await saveFinanceBill(bill?.id ?? null, {
        direction,
        counterparty,
        description,
        categoryId: categoryId || null,
        costCenterId: centerId || null,
        cents,
        dueOn,
        competenceOn: competence ? `${competence}-01` : null,
        typedLine: digits.length === 47 || digits.length === 48 ? digits : null,
        barcode,
        repeat: Number(repeat) || 1,
        fileId,
      });
      if (result.ok) onSaved(result.months);
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={close}
      closeLabel={t("finance-cancel")}
      icon={direction === "pay" ? <NiReceipt size="medium" /> : <NiMoney size="medium" />}
      tone={direction === "pay" ? "accent-2" : "secondary"}
      busy={busy || slot.kind === "sending" || slot.kind === "reading"}
      title={t(NEW_KEY[direction])}
      description={t("finance-bill-panel-body")}
      onSubmit={() => (stage === "form" ? void save() : undefined)}
      actions={
        <>
          {stage === "form" ? (
            <Button type="submit" variant="contained" disabled={busy || slot.kind === "sending"}>
              {busy ? t("finance-saving") : t("finance-save")}
            </Button>
          ) : (
            <Button variant="outlined" color="grey" onClick={() => setStage("form")}>
              {t("prefill-manual")}
            </Button>
          )}
          <Button variant="text" color="grey" onClick={close} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        <Problem problem={problem} />
        {bill ? null : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            <DocumentSlot
              id="finance-bill-doc"
              icon={<NiDocumentFull size="medium" className={TILE_TONE.primary.text} />}
              title={t(SLOT_KEY[direction])}
              hint={t("finance-doc-slot-hint")}
              state={slot}
              fileName={fileName}
              primary={stage === "start"}
              disabled={busy}
              labels={{
                send: t("prefill-send"),
                again: t("prefill-again"),
                sending: t("prefill-sending"),
                reading: t("prefill-reading"),
                read: t("prefill-read"),
                failed: t("prefill-failed"),
              }}
              onFile={(picked) => void sendDocument(picked)}
            />
          </Box>
        )}
        <TextField
          label={t("finance-bill-field-typed-line")}
          value={typed}
          onChange={(event) => readLine(event.target.value)}
          helperText={t("finance-bill-field-typed-line-help")}
          slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 70 } }}
        />
        {lineNote ? <StateLine tone={lineNote.tone}>{lineNote.text}</StateLine> : null}
        {stage === "start" ? null : (
          <>
            <TextField
              label={t("finance-field-counterparty")}
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              helperText={readHelp("counterparty", counterparty)}
            />
            <TextField
              select
              label={t("finance-field-category")}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              helperText={readHelp("category", categoryId)}
            >
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
            <Box className="grid gap-4 sm:grid-cols-2">
              <CurrencyField
                label={t("finance-bill-field-value")}
                currencySymbol="R$"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                helperText={readHelp("value", value)}
              />
              <TextField
                type="date"
                label={t("finance-bill-field-due")}
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
                helperText={readHelp("due", dueOn)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="month"
                label={t("finance-bill-field-competence")}
                value={competence}
                onChange={(event) => setCompetence(event.target.value)}
                helperText={readHelp("competence", competence) ?? t("finance-bill-field-competence-help")}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {bill ? null : (
                <TextField
                  select
                  label={t("finance-bill-field-repeat")}
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                >
                  {["1", "2", "3", "6", "12", "24"].map((months) => (
                    <MenuItem key={months} value={months}>
                      {months === "1" ? t("finance-bill-once") : t("finance-bill-months", { count: Number(months) })}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
            {centers.length > 0 ? (
              <TextField
                select
                label={t("finance-field-cost-center")}
                value={centerId}
                onChange={(event) => setCenterId(event.target.value)}
              >
                <MenuItem value="">{t("finance-none")}</MenuItem>
                {centers.map((center) => (
                  <MenuItem key={center.id} value={center.id}>
                    {center.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <TextField
              label={t("finance-field-description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              helperText={readHelp("description", description)}
              multiline
              minRows={2}
            />
          </>
        )}
      </Box>
    </SidePanel>
  );
}

/**
 * A payment or a receipt of a bill a person registers (0129): the account, the day and the value; a value less than
 * what is owed leaves the bill open by the rest, unless the person says the rest was a discount. ONE joins it to the
 * statement's line when it arrives.
 */
export function SettlePanel({
  bill,
  registrations,
  onClose,
  onSaved,
}: {
  bill: FinanceBill;
  registrations: FinanceRegistrations;
  onClose: () => void;
  onSaved: (status: string) => void;
}) {
  const t = useTranslations("product");
  const accounts = registrations.accounts.filter((account) => !account.archived);
  const owed = billRest(bill);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [paidOn, setPaidOn] = useState(today());
  const [value, setValue] = useState(centsText(owed));
  const [discount, setDiscount] = useState(false);
  // The fine the person typed of what was paid above the bill (0192); null while untouched, the contract's then.
  const [fineText, setFineText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  const cents = parseCents(value) ?? 0;
  const short = cents > 0 && cents < owed;
  const extra = cents > owed ? cents - owed : 0;
  const byContract = extra > 0 && paidOn > bill.dueOn ? contractSplit(owed, extra, bill.lateTerms) : null;
  const fineShown = fineText ?? (byContract ? centsText(byContract.fineCents) : "");
  const fine = fineShown.trim() ? parseCents(fineShown) : null;
  const interest = fine !== null && fine <= extra ? extra - fine : null;

  const save = async () => {
    if (!cents || cents <= 0) return setProblem({ code: "invalid_data", field: "cents" });
    if (extra > 0 && fineShown.trim() && (fine === null || fine < 0 || fine > extra)) {
      return setProblem({ code: "invalid_data", field: "late" });
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await settleFinanceBill(bill.id, {
        accountId,
        paidOn,
        cents,
        discountCents: short && discount ? owed - cents : 0,
        late: extra > 0 && fine !== null && interest !== null ? { fineCents: fine, interestCents: interest } : null,
      });
      if (result.ok) onSaved(result.status);
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={<NiMoney size="medium" />}
      tone="secondary"
      busy={busy}
      title={t(SETTLE_KEY[bill.direction], {
        value: money(owed),
      })}
      description={t("finance-bill-settle-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || accounts.length === 0}>
            {busy ? t("finance-saving") : t("finance-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        <StateLine tone="info">
          {[bill.counterparty ?? bill.description ?? bill.category, bill.dueOn.split("-").reverse().join("/")]
            .filter(Boolean)
            .join(" · ")}
        </StateLine>
        <Problem problem={problem} />
        {accounts.length === 0 ? <StateLine tone="attention">{t("finance-entry-no-account")}</StateLine> : null}
        <TextField
          select
          label={t("finance-field-account")}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          {accounts.map((account) => (
            <MenuItem key={account.id} value={account.id}>
              {account.name}
            </MenuItem>
          ))}
        </TextField>
        <Box className="grid gap-4 sm:grid-cols-2">
          <CurrencyField
            label={t("finance-bill-field-value")}
            currencySymbol="R$"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <TextField
            type="date"
            label={t("finance-bill-field-paid-on")}
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        {short ? (
          <TextField
            select
            label={t("finance-bill-rest")}
            value={discount ? "discount" : "open"}
            onChange={(event) => setDiscount(event.target.value === "discount")}
          >
            <MenuItem value="open">{t("finance-bill-rest-open", { value: money(owed - cents) })}</MenuItem>
            <MenuItem value="discount">{t("finance-bill-rest-discount", { value: money(owed - cents) })}</MenuItem>
          </TextField>
        ) : null}
        {extra > 0 ? (
          <LateFields
            extra={extra}
            fine={fineShown}
            interest={interest}
            onFine={setFineText}
            note={
              fineText === null && byContract ? t("finance-bill-split-contract-hint") : t("finance-bill-split-hint")
            }
          />
        ) : null}
      </Box>
    </SidePanel>
  );
}

/** What was paid above a bill, said as its fine (typed) and its interest (the rest), each a field of its own (0192). */
function LateFields({
  extra,
  fine,
  interest,
  onFine,
  note,
}: {
  extra: number;
  fine: string;
  interest: number | null;
  onFine: (value: string) => void;
  note: string;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-3">
      <StateLine tone="info">{t("finance-bill-settle-extra", { value: money(extra) })}</StateLine>
      <Box className="grid gap-4 sm:grid-cols-2">
        <CurrencyField
          label={t("finance-bill-field-fine")}
          currencySymbol="R$"
          value={fine}
          onChange={(event) => onFine(event.target.value)}
        />
        <TextField
          label={t("finance-bill-field-interest")}
          value={interest !== null ? money(interest) : ""}
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
        />
      </Box>
      <Typography variant="caption" className="text-text-secondary">
        {note}
      </Typography>
    </Box>
  );
}

/**
 * Who operates the books says how much of what a payment paid above its bill was the fine and how much the interest
 * (0192): a payment nobody split, or one ONE split by the contract. Saving with no fine takes the split back.
 */
export function SplitPanel({
  bill,
  onClose,
  onSaved,
}: {
  bill: FinanceBill;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const payments = bill.latePayments;
  const [paymentId, setPaymentId] = useState((payments.find((payment) => !payment.splitBy) ?? payments[0])?.id ?? "");
  const payment = payments.find((item) => item.id === paymentId) ?? null;
  const [fineText, setFineText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  const extra = payment?.extraCents ?? 0;
  const fineShown = fineText ?? (payment?.splitBy ? centsText(payment.fineCents) : "");
  const fine = fineShown.trim() ? parseCents(fineShown) : null;
  const interest = fine !== null && fine <= extra ? extra - fine : null;

  const save = async () => {
    if (!payment) return;
    if (fineShown.trim() && (fine === null || fine < 0 || fine > extra)) {
      return setProblem({ code: "invalid_data", field: "late" });
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await splitFinancePayment(
        payment.id,
        fine !== null && interest !== null ? { fineCents: fine, interestCents: interest } : null,
      );
      if (result.ok) onSaved();
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={<NiMoney size="medium" />}
      tone="secondary"
      busy={busy}
      title={t("finance-bill-split-title")}
      description={t("finance-bill-split-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !payment}>
            {busy ? t("finance-saving") : t("finance-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        <StateLine tone="info">
          {[bill.counterparty ?? bill.description ?? bill.category, bill.dueOn.split("-").reverse().join("/")]
            .filter(Boolean)
            .join(" · ")}
        </StateLine>
        <Problem problem={problem} />
        {payments.length > 1 ? (
          <TextField
            select
            label={t("finance-bill-split-payment")}
            value={paymentId}
            onChange={(event) => {
              setPaymentId(event.target.value);
              setFineText(null);
            }}
          >
            {payments.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {t("finance-bill-split-payment-option", {
                  day: item.paidOn.split("-").reverse().join("/"),
                  value: money(item.extraCents),
                })}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {payment ? (
          <LateFields
            extra={extra}
            fine={fineShown}
            interest={interest}
            onFine={setFineText}
            note={payment.splitBy === "contract" ? t("finance-bill-split-contract") : t("finance-bill-split-clear")}
          />
        ) : null}
      </Box>
    </SidePanel>
  );
}

/** A renegotiation (0129): how many installments and the first due day; ONE splits what is owed so it adds up. */
export function RenegotiatePanel({
  bill,
  onClose,
  onSaved,
}: {
  bill: FinanceBill;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const owed = billRest(bill);
  const [installments, setInstallments] = useState("3");
  const [firstDue, setFirstDue] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  const parts = Math.max(Number(installments) || 1, 1);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await renegotiateFinanceBill(bill.id, { installments: parts, firstDueOn: firstDue, reason });
      if (result.ok) onSaved();
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={<NiCalendarClock size="medium" />}
      tone="accent-3"
      busy={busy}
      title={t("finance-bill-renegotiate-title", { value: money(owed) })}
      description={t("finance-bill-renegotiate-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("finance-saving") : t("finance-bill-renegotiate")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        <Problem problem={problem} />
        <Box className="grid gap-4 sm:grid-cols-2">
          <TextField
            select
            label={t("finance-bill-field-installments")}
            value={installments}
            onChange={(event) => setInstallments(event.target.value)}
          >
            {["1", "2", "3", "4", "5", "6", "10", "12", "18", "24"].map((count) => (
              <MenuItem key={count} value={count}>
                {count}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="date"
            label={t("finance-bill-field-first-due")}
            value={firstDue}
            onChange={(event) => setFirstDue(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <StateLine tone="info">
          {t("finance-bill-renegotiate-each", { count: parts, value: money(Math.floor(owed / parts)) })}
        </StateLine>
        <TextField
          label={t("finance-field-reason")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
        />
      </Box>
    </SidePanel>
  );
}
