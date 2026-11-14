"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import { saveMyWhatsapp } from "@/lib/firm/whatsapp-actions";
import { createClient } from "@flyee/auth/client";
import { onlyDigits } from "@flyee/fields";

/** Why a WhatsApp was refused, in the words of the person's setup (0251). */
const WHATSAPP_REFUSAL: Record<string, string> = {
  firm_number: "person-setup-whatsapp-error-firm",
  member_number: "person-setup-whatsapp-error-member",
  invalid_phone: "person-setup-whatsapp-error-invalid",
};

/**
 * The person's own WhatsApp (migration 0187): ONE knows them by it when they send the firm's WhatsApp the result of a
 * hearing they went to, and records it on the hearing. Kept on their profile and nowhere else.
 */
export default function WhatsappCard() {
  const t = useTranslations("product");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  /** Why it was refused, when the database says (0251): the firm's number, a colleague's, a number that is none. */
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("whatsapp").eq("id", user.id).maybeSingle();
      const stored = (data as { whatsapp?: string | null } | null)?.whatsapp ?? "";
      setPhone(stored.startsWith("55") ? stored.slice(2) : stored);
      setLoaded(true);
    };
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    setRefusal(null);
    try {
      const result = await saveMyWhatsapp(onlyDigits(phone));
      setStatus(result.ok ? "saved" : "error");
      if (!result.ok) setRefusal(WHATSAPP_REFUSAL[result.code] ?? null);
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="settings-whatsapp-title" className="w-full">
      <CardContent className="flex flex-col gap-4">
        <Box>
          <Typography id="settings-whatsapp-title" variant="h6" component="h2" className="mb-1">
            {t("settings-whatsapp-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("settings-whatsapp-body")}
          </Typography>
        </Box>
        {status === "saved" ? (
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t("settings-whatsapp-saved")}
          </Alert>
        ) : status === "error" ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(refusal ?? "settings-whatsapp-error")}
          </Alert>
        ) : null}
        <Box className="flex flex-wrap items-end gap-3">
          <PhoneField
            label={t("settings-whatsapp-label")}
            value={phone}
            disabled={!loaded || saving}
            onChange={(event) => setPhone(event.target.value)}
            className="min-w-64"
          />
          <Button variant="contained" disabled={!loaded || saving} onClick={() => void save()}>
            {saving ? t("settings-whatsapp-saving") : t("settings-whatsapp-save")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
