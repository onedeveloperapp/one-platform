"use client";

import { useTranslations } from "next-intl";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { setOptOut } from "@/lib/whatsapp/actions";
import { type ConversationSummary, sendErrorKey } from "@/lib/whatsapp/conversations";

/**
 * Recording that a person asked the firm to stop writing, when they said it
 * somewhere else (a call, the office), or that they agreed to be written to
 * again. Both change what the firm may send, so both say what changes, what
 * does not, and take a note that stays in the audit trail with who recorded
 * it (`set_wa_optout`, migration 0019).
 */
export default function OptOutDialog({
  direction,
  conversation,
  onClose,
  onDone,
}: {
  direction: "record" | "remove";
  conversation: ConversationSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("product");
  const recording = direction === "record";

  return (
    <ConfirmActionDialog
      title={
        recording
          ? t("inbox-optout-record-title", { name: conversation.name })
          : t("inbox-optout-remove-title", { name: conversation.name })
      }
      consequences={
        recording
          ? [t("inbox-optout-record-consequence-1"), t("inbox-optout-record-consequence-2")]
          : [t("inbox-optout-remove-consequence-1"), t("inbox-optout-remove-consequence-2")]
      }
      staysTitle={t("inbox-optout-stays-title")}
      stays={[t("inbox-optout-stays-1"), t("inbox-optout-stays-2")]}
      reasonLabel={recording ? t("inbox-optout-record-reason") : t("inbox-optout-remove-reason")}
      reasonHelp={t("inbox-optout-reason-help")}
      reasonMinLength={8}
      confirmLabel={recording ? t("inbox-optout-record-confirm") : t("inbox-optout-remove-confirm")}
      cancelLabel={t("inbox-optout-cancel")}
      busyLabel={t("inbox-optout-busy")}
      onConfirm={async (reason) => {
        const result = await setOptOut({ conversationId: conversation.id, optedOut: recording, note: reason });
        if (!result.ok) return t(sendErrorKey(result.code));
        onDone(recording ? t("inbox-optout-done-out") : t("inbox-optout-done-in"));
        return null;
      }}
      onClose={onClose}
    />
  );
}
