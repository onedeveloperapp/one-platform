"use client";

import { LocalizedInput, SelectInput } from "../../components/fields";
import { type NewsletterDraft, previewNewsletter, sendNewsletter } from "../actions";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import MetricBars from "@/components/product/metric-bars";
import { formatNumber } from "@/lib/admin/format";
import { labelOf, LEAD_SOURCE_LABEL } from "@/lib/admin/labels";
import { NEWSLETTER_LANGUAGE_LABEL, NEWSLETTER_LANGUAGES, type NewsletterLanguage } from "@/lib/admin/newsletter";

const ALL_SOURCES = "all";

const SOURCE_OPTIONS = [
  { value: ALL_SOURCES, label: "Todos os confirmados" },
  ...Object.keys(LEAD_SOURCE_LABEL).map((source) => ({
    value: source,
    label: `Só quem veio de: ${labelOf(LEAD_SOURCE_LABEL, source)}`,
  })),
];

type Audience = { readers: Record<NewsletterLanguage, number>; total: number };

/**
 * A message to the confirmed list, in two steps: write it, then see exactly
 * who would receive it and confirm. A send cannot be taken back, so the count
 * comes before the button that sends, and the button names it.
 *
 * The text is written once per language the platform is written in, and each
 * contact gets the text of the language they signed up in. A language left
 * empty is not sent, and the dialog says so.
 */
export default function NewsletterDialog({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (queued: boolean) => void;
}) {
  const [draft, setDraft] = useState<NewsletterDraft>({ subject: {}, body: {}, source: null });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any change to the draft invalidates the count that was shown for it.
  const change = (next: Partial<NewsletterDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setAudience(null);
    setError(null);
  };

  const review = async () => {
    setBusy(true);
    setError(null);
    const result = await previewNewsletter(draft);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setAudience(result.data);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await sendNewsletter(draft);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else onSent(result.data.queued);
  };

  const written = NEWSLETTER_LANGUAGES.filter(
    (language) => draft.subject[language]?.trim() && draft.body[language]?.trim(),
  );
  const skipped = NEWSLETTER_LANGUAGES.filter((language) => !written.includes(language));

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      aria-labelledby="newsletter-dialog-title"
    >
      <DialogHeader
        id="newsletter-dialog-title"
        title={audience ? "Conferir e enviar" : "Escrever para a lista"}
        onClose={onClose}
        closeLabel="Fechar sem enviar"
      />
      <DialogContent dividers>
        {audience ? (
          <Box className="flex flex-col gap-5">
            <Typography variant="body1">
              {audience.total === 0
                ? "Ninguém receberia esta mensagem agora: não há contato confirmado na origem escolhida."
                : "Quem recebe, contado agora. Só entram contatos que confirmaram o e-mail e não se descadastraram."}
            </Typography>
            <MetricBars
              spacing="dense"
              total={audience.total}
              items={written.map((language) => ({
                key: language,
                label:
                  NEWSLETTER_LANGUAGES.length > 1 ? `Leitores em ${NEWSLETTER_LANGUAGE_LABEL[language]}` : "Leitores",
                value: audience.readers[language],
                hint: draft.subject[language]?.trim(),
              }))}
            />
            {skipped.length > 0 ? (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                Sem texto em {skipped.map((language) => NEWSLETTER_LANGUAGE_LABEL[language]).join(" e ")}: quem lê nesse
                idioma não recebe este envio.
              </Alert>
            ) : null}
            <Typography variant="body2" className="text-text-secondary">
              Depois de enviado não há como desfazer. Cada pessoa recebe uma vez, com o motivo do envio e o link de
              descadastro no fim da mensagem.
            </Typography>
          </Box>
        ) : (
          <Box className="flex flex-col gap-5">
            <Typography variant="body2" className="text-text-secondary">
              A mensagem vai para quem confirmou o e-mail e não se descadastrou.
            </Typography>
            <SelectInput
              label="Quem recebe"
              value={draft.source ?? ALL_SOURCES}
              options={SOURCE_OPTIONS}
              onChange={(value) => change({ source: value === ALL_SOURCES ? null : value })}
            />
            <LocalizedInput label="Assunto" value={draft.subject} onChange={(subject) => change({ subject })} />
            <LocalizedInput
              label="Texto"
              value={draft.body}
              onChange={(body) => change({ body })}
              multiline
              rows={10}
              help="Aceita Markdown: **negrito**, listas com hífen e links como [texto](https://endereço). O assunto vira o título da mensagem; o motivo do envio e o link de descadastro entram sozinhos no fim."
            />
          </Box>
        )}
        {error ? (
          <Alert severity="error" className="neutral bg-background-paper/60! mt-5">
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        {audience ? (
          <>
            <Button variant="text" color="grey" onClick={() => setAudience(null)} disabled={busy}>
              Voltar ao texto
            </Button>
            <Button variant="contained" onClick={send} disabled={busy || audience.total === 0}>
              {busy
                ? "Enviando…"
                : audience.total === 1
                  ? "Enviar para 1 pessoa"
                  : `Enviar para ${formatNumber(audience.total)} pessoas`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="contained" onClick={review} disabled={busy}>
              {busy ? "Contando…" : "Conferir quem recebe"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
