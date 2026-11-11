"use client";

import SettingsMenu from "../components/settings-menu";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Drawer, Grid, TextField, Tooltip, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiMessage from "@/icons/nexture/ni-message";
import type { FirmMessages } from "@/lib/firm/message-actions";
import { resetFirmMessage, restoreFirmMessage, saveFirmMessage } from "@/lib/firm/message-actions";
import { type MessageProblem, messageProblem, speaksOfPrice, suggestMessage } from "@/lib/firm/messages";

type Message = FirmMessages["messages"][number];

export type MessagesState =
  | { kind: "ready"; messages: Message[]; editable: boolean }
  | { kind: "error" }
  | { kind: "unavailable" }
  | { kind: "no-firm" };

const readKey = (kind: string) => (kind === "error" ? "messages-error-read" : "settings-unavailable");
const chipKey = (firm: boolean) => (firm ? "messages-chip-firm" : "messages-chip-one");

const PROBLEM_KEY: Record<MessageProblem["code"], string> = {
  size: "messages-problem-size",
  missing_value: "messages-problem-missing",
  unknown_value: "messages-problem-unknown",
  copy_rules: "messages-problem-copy",
  promise: "messages-problem-promise",
};

/**
 * ONE's messages in a conversation and the firm's own words of each (migration 0191, phase 6): what each is, where it
 * goes, the values it carries, the words in force (the firm's or ONE's), and for who decides for the firm the way to
 * write its version in the panel, checked as it is typed with ONE's suggestion one click away, an earlier version put
 * back and ONE's words back with a click. A template outside the 24 hours is written in the notices, never here.
 */
export default function MessagesView({ state }: { state: MessagesState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<{ ok: boolean; code?: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) setProblem(result.code === "no_longer_passes" ? "messages-error-old" : "messages-error");
      else router.refresh();
    } catch {
      setProblem("messages-error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="messages" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("settings-messages")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-messages") },
              ]}
              description={t("messages-page-description")}
            />
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {state.kind !== "ready" ? (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t(readKey(state.kind))}
            </Alert>
          </Grid>
        ) : (
          <Grid size={12} className="flex flex-col gap-4">
            {problem ? (
              <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
                {t(problem)}
              </Alert>
            ) : null}
            {!state.editable ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("messages-readonly")}
              </Typography>
            ) : null}
            {state.messages.map((message) => (
              <Card key={message.key} component="section" aria-labelledby={`message-${message.key}`}>
                <CardContent className="flex flex-col gap-2">
                  <CardTitle
                    id={`message-${message.key}`}
                    icon={<NiMessage size="medium" />}
                    title={message.name}
                    description={message.whereSaid}
                    chip={
                      <StatusChip
                        tone={message.current ? "primary" : "neutral"}
                        label={t(chipKey(message.current !== null))}
                      />
                    }
                    actions={
                      state.editable ? (
                        <QuickActions
                          label={t("messages-actions")}
                          actions={[
                            { key: "write", label: t("messages-write"), onClick: () => setEditing(message) },
                            ...(message.current
                              ? [
                                  {
                                    key: "reset",
                                    label: t("messages-reset"),
                                    disabled: busy,
                                    onClick: () => void run(() => resetFirmMessage(message.key)),
                                  },
                                ]
                              : []),
                            ...message.versions
                              .filter((version) => !version.active)
                              .slice(0, 3)
                              .map((version) => ({
                                key: `v${version.version}`,
                                label: t("messages-restore", { version: version.version }),
                                disabled: busy,
                                onClick: () => void run(() => restoreFirmMessage(message.key, version.version)),
                              })),
                          ]}
                        />
                      ) : undefined
                    }
                  />
                  <Box className="border-grey-100 bg-grey-25 rounded-xl border p-3">
                    <Typography variant="body2" className="whitespace-pre-line">
                      {message.current ?? message.example}
                    </Typography>
                  </Box>
                  <Typography variant="caption" className="text-text-secondary">
                    {t("messages-values", {
                      required: message.required.map((value) => `{${value}}`).join(", ") || t("messages-none"),
                      optional: message.optional.map((value) => `{${value}}`).join(", ") || t("messages-none"),
                    })}
                  </Typography>
                </CardContent>
              </Card>
            ))}
            <Typography variant="caption" className="text-text-secondary">
              {t("messages-templates-note")}
            </Typography>
          </Grid>
        )}
      </Grid>
      <Drawer anchor="left" open={openDrawer} onClose={() => setOpenDrawer(false)}>
        <Box className="p-4">
          <SettingsMenu active="messages" />
        </Box>
      </Drawer>
      {editing ? (
        <WritePanel
          message={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </Grid>
  );
}

/** The firm writes its version of a message: checked as typed, ONE's suggestion one click away. */
function WritePanel({ message, onClose, onSaved }: { message: Message; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const [body, setBody] = useState(message.current ?? message.example);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const problem = messageProblem(message, body);
  const suggestion = problem ? suggestMessage(message, body) : null;
  const submit = async () => {
    if (problem) return;
    setBusy(true);
    setRefused(null);
    try {
      const result = await saveFirmMessage(message.key, body);
      if (result.ok) onSaved();
      else setRefused(result.code);
    } catch {
      setRefused("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("cases-cancel")}
      title={message.name}
      description={t("messages-panel-intro")}
      icon={<NiMessage size="medium" />}
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || problem !== null}>
            {t("messages-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-3">
        {refused ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("messages-error")}
          </Alert>
        ) : null}
        <TextField
          fullWidth
          multiline
          minRows={5}
          id="message-body"
          label={t("messages-body")}
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, 1200))}
          helperText={t("messages-count", { count: body.trim().length })}
        />
        {problem ? (
          <StateLine
            tone="attention"
            action={
              suggestion ? (
                <Button variant="outlined" size="small" onClick={() => setBody(suggestion)}>
                  {t("messages-accept-suggestion")}
                </Button>
              ) : undefined
            }
          >
            {t(PROBLEM_KEY[problem.code], { value: "value" in problem ? `{${problem.value}}` : "" })}
          </StateLine>
        ) : (
          <StateLine tone="done">{t("messages-passes")}</StateLine>
        )}
        {speaksOfPrice(body) ? <StateLine tone="info">{t("messages-price-warning")}</StateLine> : null}
        <Typography variant="caption" className="text-text-secondary">
          {t("messages-values", {
            required: message.required.map((value) => `{${value}}`).join(", ") || t("messages-none"),
            optional: message.optional.map((value) => `{${value}}`).join(", ") || t("messages-none"),
          })}
        </Typography>
      </Box>
    </SidePanel>
  );
}
