"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, TextField, Typography } from "@mui/material";

import PhoneField from "@/components/product/fields/phone-field";
import StatusChip from "@/components/product/status-chip";
import { simulatePerson, simulatePhone } from "@/lib/whatsapp/actions";
import type { ConversationSummary } from "@/lib/whatsapp/conversations";
import { onlyDigits } from "@flyee/fields";

/**
 * The other side of a simulated number, on a machine with no vendor behind
 * it: somebody plays the person who writes to the firm, and the firm's own
 * phone. What is typed here enters the platform by the same door a real
 * delivery does. It renders only for a simulated number while the simulator
 * is on, and never in production.
 */
export default function SimulatorCard({
  numberId,
  conversation,
  onDelivered,
}: {
  numberId: string;
  /** The simulated conversation being read, when there is one: the person is already known. */
  conversation: ConversationSummary | null;
  onDelivered: () => void;
}) {
  const t = useTranslations("product");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"delivered" | "error" | null>(null);

  // A number as the platform keeps it: the country, then the area code and the number.
  const contact = conversation ? conversation.contact : `55${onlyDigits(phone)}`;
  const phoneOk = conversation !== null || onlyDigits(phone).length >= 10;
  const ready = phoneOk && text.trim() !== "" && !busy;

  const run = async (who: "person" | "phone") => {
    if (!ready) return;
    setBusy(true);
    setStatus(null);
    const result =
      who === "person"
        ? await simulatePerson({ numberId, phone: contact, name: conversation ? conversation.name : name, text })
        : await simulatePhone({ numberId, phone: contact, text });
    setBusy(false);
    if (!result.ok) {
      setStatus("error");
      return;
    }
    setText("");
    setStatus("delivered");
    onDelivered();
  };

  return (
    <Card component="section" aria-labelledby="inbox-simulator">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography id="inbox-simulator" variant="h5" component="h2" className="mb-0">
              {t("inbox-sim-title")}
            </Typography>
            <StatusChip label={t("inbox-sim-chip")} tone="info" />
          </Box>
          <Typography variant="body2" className="text-text-secondary max-w-3xl">
            {conversation ? t("inbox-sim-body-conversation", { name: conversation.name }) : t("inbox-sim-body")}
          </Typography>
        </Box>

        <Grid container spacing={3}>
          {conversation ? null : (
            <>
              <Grid size={{ xs: 12, md: 4 }}>
                <PhoneField
                  fullWidth
                  size="small"
                  id="inbox-sim-phone"
                  name="phone"
                  label={t("inbox-sim-phone")}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  invalidMessage={t("inbox-sim-phone-invalid")}
                  disabled={busy}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                {/* The same field as the phone beside it, so the row reads as one form. */}
                <TextField
                  fullWidth
                  size="small"
                  id="inbox-sim-name"
                  label={t("inbox-sim-name")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
              </Grid>
            </>
          )}
          <Grid size={12}>
            <TextField
              fullWidth
              size="small"
              id="inbox-sim-text"
              label={t("inbox-sim-text")}
              multiline
              minRows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: 4096 } }}
            />
          </Grid>
        </Grid>

        {status === "error" ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("inbox-sim-error")}
          </Alert>
        ) : null}
        {status === "delivered" ? (
          <Alert
            severity="success"
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setStatus(null)}
          >
            {t("inbox-sim-done")}
          </Alert>
        ) : null}

        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="contained" onClick={() => void run("person")} disabled={!ready}>
            {t("inbox-sim-as-person")}
          </Button>
          <Button variant="outlined" color="grey" onClick={() => void run("phone")} disabled={!ready}>
            {t("inbox-sim-as-phone")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
