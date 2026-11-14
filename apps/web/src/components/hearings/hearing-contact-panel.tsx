"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField } from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import { addHearingContact, type HearingContact } from "@/lib/hearings/contacts";
import { hearingErrorKey } from "@/lib/hearings/hearings";
import { isValidPhoneBr } from "@flyee/fields";

/**
 * An attendee from outside added to the firm's list (migration 0251, the owner, 2026-11-14): who goes to hearings for
 * the firm with no account in ONE, by name and WhatsApp. ONE sends them the guide of each hearing they go to and
 * records the result they send to the firm's WhatsApp; they stay in the list for the next hearings.
 */
export default function HearingContactPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (contact: HearingContact) => void;
}) {
  const t = useTranslations("product");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field: "name" | "phone" | null } | null>(null);

  const submit = async () => {
    if (name.trim().length < 2) {
      setProblem({ code: "invalid_data", field: "name" });
      return;
    }
    if (!isValidPhoneBr(phone)) {
      setProblem({ code: phone ? "invalid_phone" : "phone_required", field: "phone" });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await addHearingContact({ name, phone });
      if (!result.ok) {
        setProblem({ code: result.code, field: result.field });
        return;
      }
      onSaved(result.contact);
    } catch {
      setProblem({ code: "failed", field: null });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: "name" | "phone") =>
    problem?.field === field ? t(hearingErrorKey(problem.code)) : undefined;

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("hearing-close")}
      title={t("hearing-contact-panel-title")}
      description={t("hearing-contact-panel-intro")}
      icon={<NiUserPlus size="medium" />}
      tone="accent-4"
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("hearing-contact-panel-submit")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("hearing-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-3">
        <TextField
          fullWidth
          size="small"
          id="hearing-contact-name"
          label={t("hearing-contact-name")}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value.slice(0, 120))}
          error={Boolean(fieldError("name"))}
          helperText={fieldError("name")}
          slotProps={{ htmlInput: { autoComplete: "off" } }}
        />
        <PhoneField
          fullWidth
          size="small"
          id="hearing-contact-phone"
          label={t("hearing-contact-phone")}
          value={phone}
          disabled={busy}
          onChange={(event) => setPhone(event.target.value)}
          error={Boolean(fieldError("phone"))}
          helperText={fieldError("phone") ?? t("hearing-contact-phone-help")}
        />
        {problem && !problem.field ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(hearingErrorKey(problem.code))}
          </Alert>
        ) : null}
      </Box>
    </SidePanel>
  );
}
