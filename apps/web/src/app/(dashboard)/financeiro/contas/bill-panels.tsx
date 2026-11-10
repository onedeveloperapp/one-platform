"use client";

import type { FinanceRegistrations } from "../load-finance";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField } from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiMoney from "@/icons/nexture/ni-money";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { renegotiateFinanceBill, saveFinanceBill, settleFinanceBill } from "@/lib/finance/actions";
import { type BillDirection, billRest, type FinanceBill } from "@/lib/finance/bills";
import { financeErrorKey, financeFieldKey, money } from "@/lib/finance/books";
import { readBoleto } from "@flyee/rules/boleto";
import { formatCents, parseCents } from "@flyee/rules/finance";

const NEW_KEY: Record<BillDirection, string> = { pay: "finance-bill-new-pay", receive: "finance-bill-new-receive" };
const SETTLE_KEY: Record<BillDirection, string> = {
  pay: "finance-bill-settle-pay",
  receive: "finance-bill-settle-receive",
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const centsText = (cents: number) => formatCents(cents).replace(/^-?R\$\s/, "");

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
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={direction === "pay" ? <NiReceipt size="medium" /> : <NiMoney size="medium" />}
      tone={direction === "pay" ? "accent-2" : "secondary"}
      busy={busy}
      title={t(NEW_KEY[direction])}
      description={t("finance-bill-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("finance-saving") : t("finance-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        <Problem problem={problem} />
        <TextField
          label={t("finance-bill-field-typed-line")}
          value={typed}
          onChange={(event) => readLine(event.target.value)}
          helperText={t("finance-bill-field-typed-line-help")}
          slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 70 } }}
        />
        {lineNote ? <StateLine tone={lineNote.tone}>{lineNote.text}</StateLine> : null}
        <TextField
          label={t("finance-field-counterparty")}
          value={counterparty}
          onChange={(event) => setCounterparty(event.target.value)}
        />
        <TextField
          select
          label={t("finance-field-category")}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
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
          />
          <TextField
            type="date"
            label={t("finance-bill-field-due")}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            type="month"
            label={t("finance-bill-field-competence")}
            value={competence}
            onChange={(event) => setCompetence(event.target.value)}
            helperText={t("finance-bill-field-competence-help")}
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
          multiline
          minRows={2}
        />
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  const cents = parseCents(value) ?? 0;
  const short = cents > 0 && cents < owed;

  const save = async () => {
    if (!cents || cents <= 0) return setProblem({ code: "invalid_data", field: "cents" });
    setBusy(true);
    setProblem(null);
    try {
      const result = await settleFinanceBill(bill.id, {
        accountId,
        paidOn,
        cents,
        discountCents: short && discount ? owed - cents : 0,
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
