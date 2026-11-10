"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, FormControlLabel, MenuItem, Skeleton, Switch, TextField, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiCalendar from "@/icons/nexture/ni-calendar";
import {
  endAgendaCalendar,
  type MorningPreview,
  previewMorningEmail,
  readAgenda,
  setAgendaDigest,
  setInternalDeadlineDays,
  startAgendaCalendar,
} from "@/lib/agenda/actions";

type Me = { wholeFirm: boolean; digestOn: boolean; calendarAt: string | null; setsInternalDays: boolean };

const ERROR_KEY: Record<string, string> = {
  support_visit: "agenda-subscribe-support",
  not_allowed: "agenda-subscribe-not-allowed",
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const when = (moment: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(moment));

/**
 * The person's agenda outside ONE (migration 0132): the e-mail of the morning (on by default, stopped in one click),
 * the calendar link the iPhone, Outlook and Google subscribe to (its address shown once: ONE keeps only its hash), and,
 * for a partner or the controladoria, how many business days before the fatal deadline the internal one comes.
 */
export default function AgendaSubscribePanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("product");
  const [me, setMe] = useState<Me | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [ending, setEnding] = useState(false);
  const [daysSaved, setDaysSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void readAgenda(today(), today(), null)
      .then((answer) => {
        if (!live) return;
        if (!answer.ok) return setFailed(true);
        setMe(answer.me);
        setDays(answer.internalDays);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const run = async (work: () => Promise<{ ok: true } | { ok: false; code: string }>, then: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (result.ok) then();
      else setProblem(t(ERROR_KEY[result.code] ?? "agenda-subscribe-failed"));
    } catch {
      setProblem(t("agenda-subscribe-failed"));
    } finally {
      setBusy(false);
    }
  };

  const makeLink = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try {
      const result = await startAgendaCalendar();
      if (result.ok) {
        setLink({ url: result.url, webcal: result.webcal });
        setMe((current) => (current ? { ...current, calendarAt: new Date().toISOString() } : current));
      } else setProblem(t(ERROR_KEY[result.code] ?? "agenda-subscribe-failed"));
    } catch {
      setProblem(t("agenda-subscribe-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("agenda-close")}
      icon={<NiCalendar size="medium" />}
      tone="primary"
      busy={busy}
      title={t("agenda-subscribe-title")}
      description={t("agenda-subscribe-body")}
      actions={
        <Button variant="text" color="grey" onClick={onClose}>
          {t("agenda-close")}
        </Button>
      }
    >
      <Box className="flex flex-col gap-6">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        {failed ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("agenda-load-failed")}
          </Alert>
        ) : !me ? (
          <Skeleton variant="rounded" height={220} />
        ) : (
          <>
            <Box component="section" className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3">
                {t("agenda-digest-title")}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={me.digestOn}
                    disabled={busy}
                    onChange={(event) => {
                      const on = event.target.checked;
                      void run(
                        () => setAgendaDigest(on),
                        () => setMe({ ...me, digestOn: on }),
                      );
                    }}
                  />
                }
                label={t("agenda-digest-on")}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t(me.wholeFirm ? "agenda-digest-whole" : "agenda-digest-own")}
              </Typography>
              <MorningPreviewBox />
            </Box>

            <Box component="section" className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3">
                {t("agenda-link-title")}
              </Typography>
              {link ? (
                <>
                  <StateLine tone="done">{t("agenda-link-shown")}</StateLine>
                  <TextField
                    value={link.url}
                    label={t("agenda-link-address")}
                    slotProps={{ htmlInput: { readOnly: true } }}
                    onFocus={(event) => event.target.select()}
                  />
                  <Box className="flex flex-wrap gap-2">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(link.url)
                          .then(() => setCopied(true))
                          .catch(() => setCopied(false));
                      }}
                    >
                      {t(copied ? "agenda-link-copied" : "agenda-link-copy")}
                    </Button>
                    <Button variant="outlined" color="grey" size="small" href={link.webcal}>
                      {t("agenda-link-open")}
                    </Button>
                  </Box>
                </>
              ) : me.calendarAt ? (
                <StateLine tone="done">{t("agenda-link-since", { when: when(me.calendarAt) })}</StateLine>
              ) : (
                <Typography variant="body2" className="text-text-secondary">
                  {t("agenda-link-none")}
                </Typography>
              )}
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant={me.calendarAt ? "outlined" : "contained"}
                  color={me.calendarAt ? "grey" : "primary"}
                  size="small"
                  disabled={busy}
                  onClick={() => void makeLink()}
                >
                  {t(me.calendarAt ? "agenda-link-new" : "agenda-link-make")}
                </Button>
                {me.calendarAt ? (
                  <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setEnding(true)}>
                    {t("agenda-link-end")}
                  </Button>
                ) : null}
              </Box>
              <Typography variant="caption" className="text-text-secondary">
                {t("agenda-link-delay")}
              </Typography>
            </Box>

            {me.setsInternalDays && days !== null ? (
              <Box component="section" className="flex flex-col gap-2">
                <Typography variant="subtitle2" component="h3">
                  {t("agenda-internal-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("agenda-internal-body")}
                </Typography>
                <Box className="flex flex-wrap items-center gap-2">
                  <TextField
                    select
                    size="small"
                    label={t("agenda-internal-title")}
                    value={String(days)}
                    onChange={(event) => {
                      setDays(Number(event.target.value));
                      setDaysSaved(false);
                    }}
                    className="w-56"
                  >
                    {[0, 1, 2, 3, 4, 5, 7, 10].map((count) => (
                      <MenuItem key={count} value={String(count)}>
                        {count === 0 ? t("agenda-internal-off") : t("agenda-internal-days", { count })}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setInternalDeadlineDays(days),
                        () => setDaysSaved(true),
                      )
                    }
                  >
                    {t("agenda-internal-save")}
                  </Button>
                </Box>
                {daysSaved ? <StateLine tone="done">{t("agenda-internal-saved")}</StateLine> : null}
              </Box>
            ) : null}
          </>
        )}
      </Box>
      {ending ? (
        <ConfirmActionDialog
          title={t("agenda-link-end-title")}
          intro={t("agenda-link-end-intro")}
          consequences={[t("agenda-link-end-consequence")]}
          staysTitle={t("agenda-link-end-stays-title")}
          stays={[t("agenda-link-end-stays")]}
          requireReason={false}
          confirmLabel={t("agenda-link-end")}
          cancelLabel={t("agenda-close")}
          onClose={() => setEnding(false)}
          onConfirm={async () => {
            try {
              const result = await endAgendaCalendar();
              if (!result.ok) return t(ERROR_KEY[result.code] ?? "agenda-subscribe-failed");
              setLink(null);
              setMe((current) => (current ? { ...current, calendarAt: null } : current));
              setEnding(false);
              return null;
            } catch {
              return t("agenda-subscribe-failed");
            }
          }}
        />
      ) : null}
    </SidePanel>
  );
}

/**
 * The person's e-mail of this morning as the backend would write it (0132): the same items and words, shown here also
 * where this environment sends no e-mail, so a test sees what would arrive.
 */
function MorningPreviewBox() {
  const t = useTranslations("product");
  const [preview, setPreview] = useState<MorningPreview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const show = async () => {
    setState("loading");
    try {
      const answer = await previewMorningEmail();
      if (answer.ok) {
        setPreview(answer.preview);
        setState("idle");
      } else setState("error");
    } catch {
      setState("error");
    }
  };
  if (!preview) {
    return (
      <Box className="flex flex-col gap-1">
        <Box>
          <Button size="small" variant="text" disabled={state === "loading"} onClick={() => void show()}>
            {t("agenda-preview-show")}
          </Button>
        </Box>
        {state === "error" ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("agenda-load-failed")}
          </Typography>
        ) : null}
      </Box>
    );
  }
  const empty = preview.today.length === 0 && preview.next.length === 0;
  const lines = (items: MorningPreview["today"]) => (
    <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((line, index) => (
        <Typography key={`${index}:${line.text}`} component="li" variant="body2">
          {line.changed ? t("agenda-preview-changed", { text: line.text }) : line.text}
        </Typography>
      ))}
    </Box>
  );
  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-lg border p-3">
      <Typography variant="subtitle2">{t("agenda-preview-subject", { day: preview.day })}</Typography>
      {!preview.configured ? <StateLine tone="info">{t("agenda-preview-not-configured")}</StateLine> : null}
      {!preview.businessDay ? (
        <StateLine tone="info">{t("agenda-preview-not-business")}</StateLine>
      ) : empty ? (
        <StateLine tone="info">{t("agenda-preview-empty")}</StateLine>
      ) : null}
      {!empty ? (
        <>
          <Typography variant="caption" className="text-text-secondary font-semibold">
            {t("agenda-preview-today")}
          </Typography>
          {preview.today.length > 0 ? (
            lines(preview.today)
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("agenda-preview-today-none")}
            </Typography>
          )}
          {preview.next.length > 0 ? (
            <>
              <Typography variant="caption" className="text-text-secondary font-semibold">
                {t("agenda-preview-next")}
              </Typography>
              {lines(preview.next)}
            </>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
