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
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import StatusChip from "@/components/product/status-chip";
import { endTestChat, renewTestChatLink, startTestChat } from "@/lib/test-chat/actions";
import type { TestChatCard as TestChatState } from "@/lib/test-chat/test-chat";
import { connectErrorKey } from "@/lib/whatsapp/connections";

/**
 * The firm's test chat (migration 0047). While the firm has no WhatsApp at
 * the vendor, who manages it turns the test chat on and hands its link to
 * whoever tests: the page stands where a passenger's phone stands, with four
 * passengers ready and the tools that make their flights' problems happen.
 * The link is copied or opened here, changed when it went where it should
 * not, and the chat turned off after a confirmation that says what stays.
 * The firm's first real number ends it, and the card says so.
 */
export default function TestChatCard({
  state,
  url,
  sinceLabel,
  blocked,
  onChanged,
  embedded = false,
}: {
  state: TestChatState;
  /** The page's address, written from the link's secret, for who may hand it out. */
  url: string | null;
  sinceLabel: string | null;
  blocked: boolean;
  onChanged: () => void;
  /** Inside another screen's flow (the firm's setup): the section without its card, its title a level down. */
  embedded?: boolean;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"renew" | "end" | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; code: string }>) => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    const result = await action().catch(() => ({ ok: false, code: "failed" }));
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return result.code;
    }
    onChanged();
    return null;
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const content = (
    <>
      <Box className="flex flex-col gap-1">
        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Typography
            id="connections-test-chat"
            variant={embedded ? "subtitle2" : "h5"}
            component={embedded ? "h3" : "h2"}
            className="mb-0"
          >
            {t("connections-test-chat-title")}
          </Typography>
          <StatusChip
            tone={state.on ? "positive" : "neutral"}
            label={state.on ? t("connections-test-chat-on") : t("connections-test-chat-off")}
          />
        </Box>
        <Typography variant="body2" className="text-text-secondary max-w-3xl">
          {t("connections-test-chat-body")}
        </Typography>
      </Box>

      {state.on ? (
        <>
          {sinceLabel ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-test-chat-since", { when: sinceLabel })}
            </Typography>
          ) : null}
          {url ? (
            <Box className="flex flex-col gap-2">
              <FormControl className="outlined" variant="standard">
                <FormLabel htmlFor="connections-test-chat-url">{t("connections-test-chat-link")}</FormLabel>
                <Input
                  id="connections-test-chat-url"
                  value={url}
                  readOnly
                  aria-describedby="connections-test-chat-url-help"
                />
                <FormHelperText id="connections-test-chat-url-help">
                  {copied ? t("connections-test-chat-copied") : t("connections-test-chat-link-help")}
                </FormHelperText>
              </FormControl>
              <Box className="flex flex-row flex-wrap gap-2">
                <Button variant="contained" onClick={() => void copy()}>
                  {t("connections-test-chat-copy")}
                </Button>
                <Button variant="outlined" color="grey" href={url} target="_blank" rel="noopener noreferrer">
                  {t("connections-test-chat-open")}
                </Button>
                {!blocked ? (
                  <>
                    <Button variant="text" color="grey" disabled={busy} onClick={() => setConfirming("renew")}>
                      {t("connections-test-chat-renew")}
                    </Button>
                    <Button variant="text" color="grey" disabled={busy} onClick={() => setConfirming("end")}>
                      {t("connections-test-chat-end")}
                    </Button>
                  </>
                ) : null}
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-test-chat-not-keeper")}
            </Typography>
          )}
        </>
      ) : state.realNumber ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("connections-test-chat-real-number")}
        </Typography>
      ) : (
        <Box className="flex flex-col gap-2">
          {state.endedReason === "replaced_by_real_number" ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-test-chat-ended-real")}
            </Typography>
          ) : null}
          <Box>
            <Button
              variant="contained"
              disabled={busy || blocked || !state.keeper}
              onClick={() => void run(startTestChat)}
            >
              {busy ? t("cases-working") : t("connections-test-chat-start")}
            </Button>
          </Box>
          {blocked ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-test-chat-blocked")}
            </Typography>
          ) : null}
        </Box>
      )}

      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(connectErrorKey(problem))}
        </Alert>
      ) : null}
    </>
  );

  const dialogs = (
    <>
      {confirming === "renew" ? (
        <ConfirmActionDialog
          requireReason={false}
          title={t("connections-test-chat-renew-title")}
          consequences={[t("connections-test-chat-renew-does")]}
          staysTitle={t("connections-test-chat-stays")}
          stays={[t("connections-test-chat-renew-stays")]}
          confirmLabel={t("connections-test-chat-renew")}
          cancelLabel={t("connections-test-chat-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async () => {
            const failed = await run(renewTestChatLink);
            if (!failed) setConfirming(null);
            return failed ? t(connectErrorKey(failed)) : null;
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "end" ? (
        <ConfirmActionDialog
          requireReason={false}
          tone="danger"
          title={t("connections-test-chat-end-title")}
          consequences={[t("connections-test-chat-end-does")]}
          staysTitle={t("connections-test-chat-stays")}
          stays={[t("connections-test-chat-end-stays")]}
          confirmLabel={t("connections-test-chat-end")}
          cancelLabel={t("connections-test-chat-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async () => {
            const failed = await run(endTestChat);
            if (!failed) setConfirming(null);
            return failed ? t(connectErrorKey(failed)) : null;
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <Box component="section" aria-labelledby="connections-test-chat" className="flex flex-col gap-4">
        {content}
        {dialogs}
      </Box>
    );
  }
  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-test-chat">
        <CardContent className="flex flex-col gap-4">{content}</CardContent>
      </Card>
      {dialogs}
    </Grid>
  );
}
