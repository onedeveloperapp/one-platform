"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Collapse, Tab, Tabs, TextField, Typography } from "@mui/material";

import MessageBubble from "@/components/product/message-bubble";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPlane from "@/icons/nexture/ni-plane";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { flightLabel } from "@/lib/flight-alerts/words";
import {
  readTestChat,
  readTestThread,
  runTestTool,
  sendTestMedia,
  sendTestMessage,
  startTestMedia,
} from "@/lib/test-chat/actions";
import {
  QUICK_REPLIES,
  TEST_TOOLS,
  type TestChatView,
  type TestMessage,
  type TestTripView,
  TRIP_KEY,
  waitsForChoice,
} from "@/lib/test-chat/test-chat";

/** How often the conversation is read again while the page is open, and the trips' state. */
const THREAD_EVERY_MS = 2_000;
const VIEW_EVERY_MS = 8_000;

const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(iso),
  );

/** A local time of an airport as the ticket prints it: 08:10. */
const clockOf = (local: string | null) => (local ? local.slice(11, 16) : "");

/** What a source says of a leg, in words. */
const LEG_KEY: Record<string, string> = {
  scheduled: "test-chat-leg-scheduled",
  delayed: "test-chat-leg-delayed-unknown",
  cancelled: "test-chat-leg-cancelled",
  changed: "test-chat-leg-changed",
  landed: "test-chat-leg-landed",
};

/** What the page says of a file the passenger sent, in place of its text. */
const FILE_KEY: Record<string, string> = {
  image: "test-chat-photo",
  document: "test-chat-pdf",
  audio: "test-chat-audio",
  video: "test-chat-video",
};

/** The words of a file that did not go. */
const fileErrorKey = (code: string): string =>
  code === "type_not_allowed"
    ? "test-chat-attach-type"
    : code === "too_large"
      ? "test-chat-attach-large"
      : code === "too_many"
        ? "test-chat-too-many"
        : "test-chat-attach-error";

const LEG_TONE: Record<string, StatusTone> = {
  scheduled: "positive",
  delayed: "attention",
  cancelled: "danger",
  changed: "attention",
  landed: "neutral",
};

/**
 * The test chat, where a passenger's phone stands: the four ready passengers,
 * each with their trip and the tools that make its problem happen, and the
 * conversation each has with the firm, read again every two seconds. What
 * the tester writes, or a photo, a PDF or an audio they send, goes to the firm
 * as the passenger's message, through the same path a real one takes; nothing
 * leaves ONE.
 */
export default function TestChat({ token, initial }: { token: string; initial: TestChatView }) {
  const t = useTranslations("product");
  const [view, setView] = useState(initial);
  const [tripId, setTripId] = useState(initial.trips[0]?.id ?? "");
  const [threads, setThreads] = useState<Record<string, TestMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "warning" | "error"; text: string } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  const listRef = useRef<HTMLUListElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [sendingFile, setSendingFile] = useState(false);

  const trip = view.trips.find((item) => item.id === tripId) ?? view.trips[0] ?? null;
  const messages = (trip && threads[trip.id]) ?? [];
  // What the page already has, read by the pull without starting it again at every message.
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const refreshView = useCallback(async () => {
    const read = await readTestChat(token).catch(() => null);
    if (read?.ok) setView(read.view);
  }, [token]);

  // The conversation of the trip in front of the tester, read again while the page is open: only what is new.
  const currentTrip = trip?.id ?? null;
  useEffect(() => {
    if (!currentTrip) return;
    let alive = true;
    const id = currentTrip;
    const pull = async () => {
      const known = threadsRef.current[id] ?? [];
      const after = known.length > 0 ? known[known.length - 1].at : null;
      const read = await readTestThread(token, id, after).catch(() => null);
      if (!alive || !read?.ok || read.messages.length === 0) return;
      setThreads((current) => {
        const had = current[id] ?? [];
        const seen = new Set(had.map((message) => message.id));
        return { ...current, [id]: [...had, ...read.messages.filter((message) => !seen.has(message.id))] };
      });
    };
    void pull();
    const timer = setInterval(() => void pull(), THREAD_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, currentTrip]);

  useEffect(() => {
    const timer = setInterval(() => void refreshView(), VIEW_EVERY_MS);
    return () => clearInterval(timer);
  }, [refreshView]);

  // The newest message in sight.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, tripId]);

  if (!trip) {
    return (
      <Box className="flex min-h-screen w-full justify-center px-4 py-8">
        <Typography variant="body1">{t("test-chat-no-trips")}</Typography>
      </Box>
    );
  }

  const send = async (input: { text?: string; reply?: string }) => {
    setBusy(true);
    setNotice(null);
    const result = await sendTestMessage(token, trip.id, input).catch(() => ({ ok: false, code: "failed" }));
    setBusy(false);
    if (!result.ok) {
      setNotice({
        tone: "error",
        text: result.code === "too_many" ? t("test-chat-too-many") : t("test-chat-send-error"),
      });
      return false;
    }
    void refreshView();
    return true;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (await send({ text })) setDraft("");
  };

  // A file goes as WhatsApp sends one: to where the vendor would keep it, then as the passenger's message.
  const attach = async (file: File) => {
    setSendingFile(true);
    setNotice(null);
    try {
      const mime = mimeOf(file);
      const started = await startTestMedia(token, trip.id, { mime, bytes: file.size });
      if (!started.ok) {
        setNotice({ tone: "error", text: t(fileErrorKey(started.code)) });
        return;
      }
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      const sent = uploaded
        ? await sendTestMedia(token, trip.id, { mediaId: started.mediaId, mime, name: file.name })
        : { ok: false, code: "not_uploaded" };
      if (!sent.ok) setNotice({ tone: "error", text: t(fileErrorKey(sent.code)) });
      else void refreshView();
    } catch {
      setNotice({ tone: "error", text: t("test-chat-attach-error") });
    } finally {
      setSendingFile(false);
    }
  };

  const runTool = async (key: string) => {
    setBusy(true);
    setNotice(null);
    const result = await runTestTool(token, trip.id, key).catch(() => ({ ok: false, code: "failed" }) as const);
    setBusy(false);
    await refreshView();
    if (!result.ok) {
      setNotice({
        tone: "error",
        text: result.code === "too_many" ? t("test-chat-too-many") : t("test-chat-tool-error"),
      });
      return;
    }
    if (result.code === "told") setNotice({ tone: "success", text: t("test-chat-told") });
    else if (result.code === "quiet")
      setNotice({ tone: "info", text: t("test-chat-quiet", { hours: Math.round(view.delayMinutes / 60) }) });
    else if (result.code === "already") setNotice({ tone: "info", text: t("test-chat-already") });
    else if (result.code === "reset") setNotice({ tone: "info", text: t("test-chat-reset-done") });
    else if (result.code === "not_told") {
      const reason = "reason" in result ? (result.reason ?? null) : null;
      setNotice({ tone: "warning", text: t("test-chat-not-told", { reason: t(reasonKey(reason)) }) });
    }
  };

  const choosing = waitsForChoice(messages);

  return (
    <Box className="flex min-h-screen w-full justify-center px-3 py-4 sm:px-4 sm:py-8">
      <Box className="flex w-full max-w-3xl flex-col gap-4">
        <Box className="flex flex-col gap-1 px-1">
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography variant="h1" component="h1" className="mb-0 text-2xl sm:text-3xl">
              {t("test-chat-title")}
            </Typography>
            <StatusChip tone="info" label={t("test-chat-chip")} />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {t("test-chat-subtitle", { firm: view.firm })}
          </Typography>
        </Box>

        {/* The tabs scroll inside their own width: the theme's tabs reach a little past it on a phone. */}
        <Box className="max-w-full min-w-0 overflow-hidden">
          <Tabs
            value={trip.id}
            onChange={(_, value: string) => {
              setTripId(value);
              setNotice(null);
              setDraft("");
            }}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label={t("test-chat-passengers")}
          >
            {view.trips.map((item) => (
              <Tab
                key={item.id}
                value={item.id}
                label={`${item.passengerName.split(" ")[0]} · ${t(TRIP_KEY[item.label])}`}
                className="normal-case"
              />
            ))}
          </Tabs>
        </Box>

        <TripTools
          trip={trip}
          open={toolsOpen}
          busy={busy}
          onToggle={() => setToolsOpen((open) => !open)}
          onTool={(key) => void runTool(key)}
        />

        {notice ? (
          <Alert severity={notice.tone} className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        ) : null}

        <Card component="section" aria-labelledby="test-chat-thread">
          <CardContent className="flex flex-col gap-3">
            <Typography id="test-chat-thread" variant="h5" component="h2" className="mb-0">
              {t("test-chat-thread-title", { firm: view.firm })}
            </Typography>
            <Box
              component="ul"
              ref={listRef}
              className="m-0 flex max-h-[55vh] min-h-48 list-none flex-col gap-2 overflow-y-auto p-0"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <Box component="li">
                  <Typography variant="body2" className="text-text-secondary">
                    {t("test-chat-empty-thread")}
                  </Typography>
                </Box>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    side={message.direction === "in" ? "out" : "in"}
                    sideLabel={
                      message.direction === "in"
                        ? t("test-chat-you-said")
                        : t("test-chat-firm-said", { firm: view.firm })
                    }
                    meta={<span>{timeOf(message.at)}</span>}
                  >
                    {FILE_KEY[message.kind] ? (
                      <>
                        <em>{t(FILE_KEY[message.kind], { name: message.mediaFilename ?? "" })}</em>
                        {message.body ? <span className="block">{message.body}</span> : null}
                      </>
                    ) : (
                      (message.body ?? (message.mediaFilename ? message.mediaFilename : t("test-chat-no-text")))
                    )}
                  </MessageBubble>
                ))
              )}
            </Box>

            {choosing ? (
              <Box className="flex flex-row flex-wrap gap-2" role="group" aria-label={t("test-chat-replies")}>
                {QUICK_REPLIES.map((reply) => (
                  <Button
                    key={reply}
                    variant="outlined"
                    color="primary"
                    disabled={busy}
                    onClick={() => void send({ reply })}
                    aria-label={t("test-chat-reply-label", { reply })}
                  >
                    {reply}
                  </Button>
                ))}
              </Box>
            ) : null}

            <Box className="flex flex-row items-end gap-2">
              <TextField
                id="test-chat-draft"
                label={t("test-chat-draft-label")}
                placeholder={t("test-chat-placeholder")}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 4096))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                multiline
                maxRows={4}
                fullWidth
                size="small"
                disabled={busy}
              />
              <input
                ref={picker}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp,application/pdf,audio/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void attach(file);
                }}
              />
              <Button
                variant="outlined"
                color="grey"
                disabled={busy || sendingFile}
                onClick={() => picker.current?.click()}
                aria-label={sendingFile ? t("test-chat-attach-sending") : t("test-chat-attach")}
                title={t("test-chat-attach")}
                className="icon-only"
              >
                <NiPaperclip size="medium" />
              </Button>
              <Button
                variant="contained"
                disabled={busy || draft.trim() === ""}
                onClick={() => void submit()}
                aria-label={t("test-chat-send")}
                className="icon-only"
              >
                <NiSendRight size="medium" />
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}

/** Why ONE could not write, in words. */
function reasonKey(reason: string | null): string {
  switch (reason) {
    case "opted_out":
      return "test-chat-reason-opted-out";
    case "no_template":
      return "test-chat-reason-no-template";
    case "no_number":
      return "test-chat-reason-no-number";
    case "trip_closed":
      return "test-chat-reason-trip-closed";
    default:
      return "test-chat-reason-other";
  }
}

/** The trip of a passenger and the tools that make its problem happen. */
function TripTools({
  trip,
  open,
  busy,
  onToggle,
  onTool,
}: {
  trip: TestTripView;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onTool: (key: string) => void;
}) {
  const t = useTranslations("product");
  const legStatus = (status: string, estimated: string | null) =>
    status === "delayed" && estimated
      ? t("test-chat-leg-delayed", { time: clockOf(estimated) })
      : t(LEG_KEY[status] ?? "test-chat-leg-scheduled");
  return (
    <Card component="section" aria-labelledby="test-chat-tools">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
          <Box className="flex min-w-0 flex-1 basis-60 flex-col">
            <Typography id="test-chat-tools" variant="h5" component="h2" className="mb-0">
              {trip.passengerName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {trip.companions.length > 0
                ? t("test-chat-companions", { names: trip.companions.map((companion) => companion.name).join(", ") })
                : t("test-chat-alone")}
            </Typography>
          </Box>
          <Button variant="text" color="grey" size="small" onClick={onToggle} aria-expanded={open}>
            {open ? t("test-chat-tools-hide") : t("test-chat-tools-show")}
          </Button>
        </Box>

        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {trip.legs.map((leg) => (
            <Box component="li" key={leg.position} className="flex flex-row flex-wrap items-center gap-2">
              <NiPlane size="small" className="text-text-secondary" />
              <Typography variant="body2" className="min-w-0 flex-1 basis-60">
                {t("test-chat-leg", {
                  flight: flightLabel(leg.flightNumber),
                  from: leg.originCity ? `${leg.originCity} (${leg.origin})` : leg.origin,
                  departure: clockOf(leg.departure),
                  to: leg.destinationCity ? `${leg.destinationCity} (${leg.destination})` : leg.destination,
                  arrival: clockOf(leg.arrival),
                })}
              </Typography>
              <StatusChip
                tone={LEG_TONE[leg.status] ?? "neutral"}
                label={legStatus(leg.status, leg.estimatedArrival)}
              />
            </Box>
          ))}
        </Box>

        {trip.alert ? (
          <Typography variant="body2" className="text-text-secondary">
            {trip.alert.status === "sent"
              ? trip.alert.answer
                ? t("test-chat-alert-answered", {
                    answer: trip.alert.answer === "yes" ? "SIM" : trip.alert.answer === "no" ? "NÃO" : "SAIR",
                  })
                : t("test-chat-alert-sent")
              : trip.alert.status === "skipped"
                ? t("test-chat-alert-skipped", { reason: t(reasonKey(trip.alert.reason)) })
                : t("test-chat-alert-due")}
          </Typography>
        ) : null}

        <Collapse in={open}>
          <Box className="border-grey-100 flex flex-col gap-3 border-t pt-3">
            <Typography variant="body2" className="text-text-secondary">
              {t("test-chat-tools-body")}
            </Typography>
            <Box className="flex flex-row flex-wrap gap-2">
              {TEST_TOOLS[trip.label].map((tool, index) => (
                <Button
                  key={tool.key}
                  variant={index === 0 ? "contained" : "outlined"}
                  color={index === 0 ? "primary" : "grey"}
                  disabled={busy}
                  onClick={() => onTool(tool.key)}
                >
                  {t(tool.label)}
                </Button>
              ))}
              <Button
                variant="text"
                color="grey"
                disabled={busy}
                onClick={() => onTool("reset")}
                startIcon={<NiRefresh size="small" />}
              >
                {t("test-chat-tool-reset")}
              </Button>
            </Box>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
