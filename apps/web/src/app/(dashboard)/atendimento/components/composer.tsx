"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";

import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { discardConversationUpload, sendFile, sendMessage, startConversationUpload } from "@/lib/whatsapp/actions";
import {
  type ComposerMode,
  type ConversationSummary,
  sendErrorKey,
  type TemplateOption,
} from "@/lib/whatsapp/conversations";
import { renderTemplate } from "@flyee/whatsapp/rules";

/** The longest text the vendor carries in one message. */
const MAX_TEXT = 4096;

/** The longest caption the vendor carries with a file. */
const MAX_CAPTION = 1024;

/**
 * The answer being written. It offers only what the database will accept for
 * this conversation right now: free text, or a file of the firm (a PDF or a
 * photo) with a caption, while the 24 hours are open; an approved template
 * when they are not; and nothing when the number is disconnected, when the
 * person asked to stop, or in a support visit. Each of those says why, and
 * what to do about it.
 */
export default function Composer({
  mode,
  conversation,
  templates,
  firmName,
  manager,
  onSent,
}: {
  mode: ComposerMode;
  conversation: ConversationSummary;
  templates: TemplateOption[];
  firmName: string;
  manager: boolean;
  onSent: () => void;
}) {
  const t = useTranslations("product");
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"queued" | "not_sent" | "unconfirmed" | null>(null);
  // A file chosen and already in the firm's storage, waiting to go with the text as its caption.
  const [attached, setAttached] = useState<{ fileId: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Until one is picked, the first approved template is the one in sight.
  const template = templates.find((option) => option.id === templateId) ?? templates[0] ?? null;
  const filled = template ? Array.from({ length: template.paramCount }, (_, index) => values[index] ?? "") : [];
  const templateReady = template !== null && filled.every((value) => value.trim() !== "");

  const send = async (input: Parameters<typeof sendMessage>[0] | Parameters<typeof sendFile>[0]) => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    setOutcome(null);
    const result = "fileId" in input ? await sendFile(input) : await sendMessage(input);
    setBusy(false);
    // Sent or refused, the file no longer waits here: one the database refused was taken back by the server.
    if ("fileId" in input) setAttached(null);
    if (!result.ok && result.code !== "not_sent" && result.code !== "unconfirmed") {
      // Refused before it was written: the text stays, with the reason beside it.
      setErrorCode(result.code);
      return;
    }
    setText("");
    setValues([]);
    if (result.code === "queued" || result.code === "not_sent" || result.code === "unconfirmed") {
      setOutcome(result.code);
    }
    onSent();
  };

  // What the button allows is what Enter allows: nothing while a file is on its way, a caption within its limit.
  const captionTooLong = attached !== null && text.length > MAX_CAPTION;
  const canSend = !busy && !uploading && (attached ? !captionTooLong : text.trim() !== "");

  const sendText = () => {
    if (!canSend) return;
    if (attached) {
      void send({ conversationId: conversation.id, fileId: attached.fileId, caption: text });
      return;
    }
    if (!text.trim()) return;
    void send({ conversationId: conversation.id, kind: "text", body: text });
  };

  const attach = async (file: File) => {
    setUploading(true);
    setErrorCode(null);
    setOutcome(null);
    try {
      const mime = mimeOf(file);
      const started = await startConversationUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) {
        setErrorCode(started.code);
        return;
      }
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) {
        await discardConversationUpload(started.fileId);
        setErrorCode("not_uploaded");
        return;
      }
      setAttached({ fileId: started.fileId, name: file.name });
    } catch {
      // A request that failed on the way (the network, the server): the button comes back.
      setErrorCode("not_uploaded");
    } finally {
      setUploading(false);
    }
  };

  const detach = () => {
    if (!attached) return;
    void discardConversationUpload(attached.fileId);
    setAttached(null);
    setErrorCode(null);
  };

  const sendTemplate = () => {
    if (!template || !templateReady) return;
    void send({
      conversationId: conversation.id,
      kind: "template",
      templateId: template.id,
      templateParams: filled.map((value) => value.trim()),
    });
  };

  const feedback = (
    <>
      {outcome === "queued" ? (
        <Alert
          severity="info"
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setOutcome(null)}
        >
          {t("inbox-sent-queued")}
        </Alert>
      ) : null}
      {outcome === "not_sent" ? (
        <Alert
          severity="warning"
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setOutcome(null)}
        >
          {t("inbox-not-sent")}
        </Alert>
      ) : null}
      {/* Not "it did not go out": nobody can tell, and sending it again may deliver it twice. */}
      {outcome === "unconfirmed" ? (
        <Alert
          severity="warning"
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setOutcome(null)}
        >
          {t("inbox-unconfirmed")}
        </Alert>
      ) : null}
    </>
  );

  if (mode === "read_only") {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("inbox-composer-read-only")}
      </Alert>
    );
  }

  if (mode === "disconnected") {
    return (
      <Alert
        severity="warning"
        className="neutral bg-background-paper/60!"
        action={
          manager ? (
            <Button color="inherit" size="small" href="/settings/connections" LinkComponent={Link}>
              {t("inbox-disconnected-action")}
            </Button>
          ) : undefined
        }
      >
        {t("inbox-composer-disconnected")}
      </Alert>
    );
  }

  if (mode === "opted_out") {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("inbox-composer-opted-out")}
      </Alert>
    );
  }

  if (mode === "template") {
    return (
      <Box className="flex flex-col gap-4">
        {feedback}
        <Typography variant="body2" className="text-text-secondary">
          {t("inbox-template-intro")}
        </Typography>
        {templates.length === 0 ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("inbox-template-none")}
          </Alert>
        ) : (
          <>
            <FormControl fullWidth className="outlined" variant="standard">
              <FormLabel component="label" htmlFor="inbox-template">
                {t("inbox-template-select")}
              </FormLabel>
              <Select
                inputProps={{ id: "inbox-template" }}
                value={template?.id ?? ""}
                onChange={(event) => {
                  setTemplateId(String(event.target.value));
                  setValues([]);
                  setErrorCode(null);
                }}
                disabled={busy}
              >
                {templates.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {template
              ? filled.map((value, index) => (
                  <FormControl key={`${template.id}-${index}`} fullWidth className="outlined" variant="standard">
                    <FormLabel component="label" htmlFor={`inbox-template-value-${index}`}>
                      {t("inbox-template-value", { number: index + 1 })}
                    </FormLabel>
                    <Input
                      id={`inbox-template-value-${index}`}
                      value={value}
                      onChange={(event) => {
                        const next = [...filled];
                        next[index] = event.target.value;
                        setValues(next);
                        setErrorCode(null);
                      }}
                      disabled={busy}
                      inputProps={{ maxLength: 500 }}
                    />
                  </FormControl>
                ))
              : null}

            {template ? (
              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle2" component="p" className="mb-0">
                  {t("inbox-template-preview")}
                </Typography>
                <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
                  {[template.headerText, renderTemplate(template.body, filled), template.footerText]
                    .filter(Boolean)
                    .join("\n\n")}
                </Typography>
              </Box>
            ) : null}

            {errorCode ? (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(sendErrorKey(errorCode))}
              </Alert>
            ) : null}

            <Box>
              <Button
                variant="contained"
                startIcon={<NiSendRight size="medium" />}
                onClick={sendTemplate}
                disabled={busy || !templateReady}
              >
                {busy ? t("inbox-sending") : t("inbox-template-send")}
              </Button>
            </Box>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box className="flex flex-col gap-3">
      {feedback}
      {attached ? (
        <Box className="border-grey-100 flex flex-row flex-wrap items-center gap-2 rounded-2xl border px-3 py-2">
          <NiPaperclip size="medium" className="text-text-secondary flex-none" />
          <Typography variant="body1" className="min-w-0 flex-1 break-all">
            {attached.name}
          </Typography>
          <Button variant="text" color="grey" size="small" onClick={detach} disabled={busy}>
            {t("inbox-file-remove")}
          </Button>
        </Box>
      ) : null}
      <FormControl fullWidth className="outlined" variant="standard" error={Boolean(errorCode) || captionTooLong}>
        <FormLabel component="label" htmlFor="inbox-composer">
          {attached ? t("inbox-file-caption") : t("inbox-composer-label", { firm: firmName })}
        </FormLabel>
        <Input
          id="inbox-composer"
          multiline
          minRows={2}
          maxRows={8}
          value={text}
          placeholder={t("inbox-composer-placeholder")}
          onChange={(event) => {
            setText(event.target.value);
            setErrorCode(null);
          }}
          onKeyDown={(event) => {
            // Enter sends; with Shift it breaks the line. While a word is being composed (an accent, an input method) it does neither.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              sendText();
            }
          }}
          disabled={busy}
          inputProps={{ maxLength: attached ? MAX_CAPTION : MAX_TEXT }}
          aria-describedby="inbox-composer-help"
        />
        <FormHelperText id="inbox-composer-help">
          {errorCode
            ? t(sendErrorKey(errorCode))
            : captionTooLong
              ? t(sendErrorKey("too_long"))
              : attached
                ? t("inbox-file-caption-help")
                : t("inbox-composer-help")}
        </FormHelperText>
      </FormControl>
      <input
        ref={picker}
        type="file"
        hidden
        accept="application/pdf,image/jpeg,image/png"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void attach(file);
        }}
      />
      <Box className="flex flex-row flex-wrap gap-2">
        <Button variant="contained" startIcon={<NiSendRight size="medium" />} onClick={sendText} disabled={!canSend}>
          {busy ? t("inbox-sending") : attached ? t("inbox-file-send") : t("inbox-send")}
        </Button>
        {attached ? null : (
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiPaperclip size="medium" />}
            onClick={() => picker.current?.click()}
            disabled={busy || uploading}
          >
            {uploading ? t("inbox-file-uploading") : t("inbox-file-attach")}
          </Button>
        )}
      </Box>
    </Box>
  );
}
