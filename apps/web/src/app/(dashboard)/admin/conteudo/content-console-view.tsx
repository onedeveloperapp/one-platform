"use client";

import {
  type ContentResult,
  removePlatformTemplate,
  retirePlatformSource,
  savePlatformSource,
  savePlatformTemplate,
} from "./actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import WordDownloadButton from "@/components/product/word-download-button";
import NiBook from "@/icons/nexture/ni-book";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import type { PlatformContent, PlatformSource, PlatformTemplate } from "@/lib/admin/platform-content";
import type { ConsoleState } from "@/lib/admin/session";
import { LIBRARY_KINDS } from "@flyee/knowledge/citations";

/**
 * The console of what ONE gives every firm (migration 0045): the models of
 * the initial of each kind of lawsuit and the sources they cite. A model is
 * the default of its kind for every firm that has no model of that kind, and
 * says it is provisional until the curator reviews it; a source is checked
 * where it was published, with the address, and answers the gate of a piece
 * of any firm. Each change is on the record.
 */

const KIND_LABEL: Record<string, string> = {
  juizado: "Juizado especial",
  comum: "Vara cível",
  any: "Os dois tipos",
};

/** What a model of the platform writes (0054): a piece, or the power of attorney ONE sends clients to sign. */
const DOCUMENT_LABEL: Record<PlatformTemplate["documentKind"], string> = {
  piece: "Peça de uma ação",
  procuracao: "Procuração",
};

const MARKS_HELP: Record<PlatformTemplate["documentKind"], string> = {
  piece:
    "Cite só fontes conferidas pelo ONE, como a biblioteca as escreve. As marcas [[PARTES]], [[RE]], [[JUIZO]], [[VALOR_DA_CAUSA]], [[PEDIDO_POR_PARTE]] e [[ADVOGADOS]] são preenchidas com os dados do caso.",
  procuracao:
    "As marcas [[OUTORGANTE]], [[OUTORGADOS]], [[ESCRITORIO]], [[RE]], [[OBJETO]], [[LOCAL_DATA]] e [[NOME]] são preenchidas com os dados de cada cliente quando o ONE envia a procuração para ele assinar. Um formulário campo por campo usa [[NOME]], [[NACIONALIDADE]], [[ESTADO_CIVIL]], [[PROFISSAO]], [[CPF]], [[NASCIMENTO]], [[ENDERECO]], [[CEP]], [[EMAIL]] e [[TELEFONE]], com [[REPRESENTADOS]] para os filhos menores e [[DATA]] para a data de hoje.",
};

const ERROR_TEXT: Record<string, string> = {
  forbidden: "Esta sessão não pode mudar o conteúdo da plataforma.",
  not_found: "Não foi encontrado: a lista mudou. Recarregue a página.",
  name_in_use: "Já existe um modelo do ONE com este nome.",
  invalid_data: "Confira o nome (de 2 a 120 letras) e o texto (pelo menos 20).",
  invalid_source:
    "A fonte não foi aceita: confira o tipo, quem a expediu (obrigatório para resolução, súmula, tema e enunciado), o número e o artigo.",
  already_in_library: "O ONE já tem esta fonte. Edite a que existe.",
  reason_required: "Diga o motivo, com pelo menos quatro letras.",
  failed: "Não foi possível salvar agora. Tente de novo.",
};

const errorText = (code: string) => ERROR_TEXT[code] ?? ERROR_TEXT.failed;

export default function ContentConsoleView({ state }: { state: ConsoleState<{ content: PlatformContent }> }) {
  const router = useRouter();
  const [templateForm, setTemplateForm] = useState<{ template: PlatformTemplate | null } | null>(null);
  const [removing, setRemoving] = useState<PlatformTemplate | null>(null);
  const [sourceForm, setSourceForm] = useState<{ source: PlatformSource | null } | null>(null);
  const [retiring, setRetiring] = useState<PlatformSource | null>(null);

  if (state.kind !== "ready") {
    return (
      <Box className="flex flex-col gap-6">
        <PageHeader
          title="Conteúdo padrão"
          crumbs={[{ label: "Admin", href: "/admin" }, { label: "Conteúdo padrão" }]}
        />
        <Alert severity={state.kind === "error" ? "error" : "info"} className="neutral bg-background-paper/60!">
          {state.kind === "error"
            ? "Não foi possível ler o conteúdo da plataforma agora."
            : "O console não está disponível nesta sessão."}
        </Alert>
      </Box>
    );
  }

  const { templates, sources } = state.content;
  const verified = sources.filter((source) => source.status === "verified");
  const retired = sources.filter((source) => source.status === "retired");
  const changed = () => router.refresh();

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title="Conteúdo padrão"
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Conteúdo padrão" }]}
        description="Os modelos e as fontes que o ONE dá a todos os escritórios. Um escritório sem modelo de um tipo de ação escreve a partir do modelo padrão do ONE desse tipo, e um escritório sem procuração própria envia aos clientes a procuração padrão do ONE."
      />

      <Card component="section" aria-labelledby="content-templates">
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-wrap items-center gap-3">
            <Typography id="content-templates" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
              Modelos do ONE
            </Typography>
            <Button variant="outlined" color="grey" onClick={() => setTemplateForm({ template: null })}>
              Novo modelo
            </Button>
          </Box>
          {templates.length === 0 ? (
            <EmptyState
              icon={<NiDocumentFull />}
              title="Nenhum modelo do ONE"
              description="Sem modelo padrão, o ONE espera que cada escritório escolha um modelo antes de escrever uma peça."
              action={{ label: "Novo modelo", onClick: () => setTemplateForm({ template: null }) }}
              titleAs="h3"
              className="py-8"
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {templates.map((template) => (
                <Box
                  component="li"
                  key={template.id}
                  className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-1 basis-60 flex-col">
                    <Typography variant="body1" className="font-semibold break-words">
                      {template.name}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {template.documentKind === "procuracao"
                        ? DOCUMENT_LABEL.procuracao
                        : KIND_LABEL[template.proceedingKind ?? "any"]}{" "}
                      · {template.body.length.toLocaleString("pt-BR")} caracteres
                    </Typography>
                  </Box>
                  {template.isDefault ? (
                    <StatusChip
                      tone="info"
                      label={template.documentKind === "procuracao" ? "Padrão" : "Padrão do tipo"}
                    />
                  ) : null}
                  {template.provisional ? <StatusChip tone="attention" label="Provisório" /> : null}
                  <Box className="flex flex-wrap gap-1">
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      onClick={() => setTemplateForm({ template })}
                      aria-label={`Editar o modelo ${template.name}`}
                    >
                      Editar
                    </Button>
                    <WordDownloadButton
                      name={template.name}
                      text={template.body}
                      label="Baixar em Word"
                      ariaLabel={`Baixar o modelo ${template.name} em Word`}
                    />
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      onClick={() => setRemoving(template)}
                      aria-label={`Remover o modelo ${template.name}`}
                    >
                      Remover
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="content-sources">
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-wrap items-center gap-3">
            <Typography id="content-sources" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
              Fontes conferidas pelo ONE
            </Typography>
            <Button variant="outlined" color="grey" onClick={() => setSourceForm({ source: null })}>
              Nova fonte
            </Button>
          </Box>
          {verified.length === 0 ? (
            <EmptyState
              icon={<NiBook />}
              title="Nenhuma fonte do ONE"
              description="As peças dos escritórios só citam fontes conferidas. Registre as que os modelos do ONE citam."
              action={{ label: "Nova fonte", onClick: () => setSourceForm({ source: null }) }}
              titleAs="h3"
              className="py-8"
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {verified.map((source) => (
                <Box
                  component="li"
                  key={source.id}
                  className="border-grey-100 flex flex-wrap items-start gap-3 border-b py-3 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                    <Typography variant="body1" className="font-semibold break-words">
                      {source.citation}
                    </Typography>
                    <Typography variant="body1" className="break-words">
                      {source.title}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary break-words">
                      {[`conferida em ${new Date(source.verifiedAt).toLocaleDateString("pt-BR")}`, source.note]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                  </Box>
                  <Box className="flex flex-wrap gap-1">
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      aria-label={`Abrir a página oficial de ${source.citation}`}
                    >
                      Abrir
                    </Button>
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      onClick={() => setSourceForm({ source })}
                      aria-label={`Editar ${source.citation}`}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      onClick={() => setRetiring(source)}
                      aria-label={`Retirar ${source.citation}`}
                    >
                      Retirar
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {retired.length > 0 ? (
            <Box className="border-grey-100 flex flex-col gap-1 border-t pt-3">
              <Typography variant="subtitle2" component="h3" className="mb-0">
                Fontes retiradas
              </Typography>
              {retired.map((source) => (
                <Typography key={source.id} variant="body2" className="text-text-secondary">
                  {source.citation} · {source.retiredReason}
                </Typography>
              ))}
            </Box>
          ) : null}
        </CardContent>
      </Card>

      {templateForm ? (
        <TemplateDialog
          template={templateForm.template}
          onClose={() => setTemplateForm(null)}
          onSaved={() => {
            setTemplateForm(null);
            changed();
          }}
        />
      ) : null}
      {sourceForm ? (
        <SourceDialog
          source={sourceForm.source}
          onClose={() => setSourceForm(null)}
          onSaved={() => {
            setSourceForm(null);
            changed();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmActionDialog
          title={`Remover o modelo ${removing.name}`}
          consequences={[
            "Nenhum escritório escreve mais a partir dele.",
            "Os escritórios sem modelo deste tipo esperam outro modelo padrão do ONE ou um modelo próprio.",
          ]}
          staysTitle="O que fica"
          stays={["As peças já pedidas a partir dele guardam o nome e o texto do modelo."]}
          requireReason={false}
          confirmLabel="Remover"
          busyLabel="Removendo"
          onConfirm={async () => {
            const result = await removePlatformTemplate(removing.id);
            if (!result.ok) return errorText(result.code);
            setRemoving(null);
            changed();
            return null;
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      {retiring ? (
        <ConfirmActionDialog
          title={`Retirar ${retiring.citation}`}
          consequences={[
            "A fonte deixa de responder pela trava das peças de todos os escritórios.",
            "Uma peça que a cita só é aprovada se o próprio escritório a tiver conferido.",
          ]}
          staysTitle="O que fica"
          stays={["A fonte fica registrada como retirada, com o motivo."]}
          reasonLabel="Motivo"
          reasonPlaceholder="Por exemplo: artigo revogado, conferido de novo no Planalto."
          reasonMinLength={4}
          confirmLabel="Retirar"
          busyLabel="Retirando"
          onConfirm={async (reason) => {
            const result = await retirePlatformSource(retiring.id, reason ?? "");
            if (!result.ok) return errorText(result.code);
            setRetiring(null);
            changed();
            return null;
          }}
          onClose={() => setRetiring(null)}
        />
      ) : null}
    </Box>
  );
}

function Refusal({ result }: { result: ContentResult | null }) {
  return result && !result.ok ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {errorText(result.code)}
    </Alert>
  ) : null;
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: PlatformTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(template?.name ?? "");
  const [writes, setWrites] = useState<PlatformTemplate["documentKind"]>(template?.documentKind ?? "piece");
  const [kind, setKind] = useState<"juizado" | "comum" | "any">(template?.proceedingKind ?? "any");
  const [body, setBody] = useState(template?.body ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [provisional, setProvisional] = useState(template?.provisional ?? true);
  const [result, setResult] = useState<ContentResult | null>(null);

  const save = () =>
    startTransition(async () => {
      const answer = await savePlatformTemplate({
        templateId: template?.id ?? null,
        name,
        documentKind: writes,
        proceedingKind: writes === "piece" && kind !== "any" ? kind : null,
        body,
        isDefault,
        provisional,
      });
      setResult(answer);
      if (answer.ok) onSaved();
    });

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      aria-labelledby="content-template-dialog"
      maxWidth="lg"
      fullWidth
    >
      <DialogHeader
        id="content-template-dialog"
        title={template ? "Editar modelo do ONE" : "Novo modelo do ONE"}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-4 pt-2!">
        <Box className="flex flex-wrap gap-3">
          <TextField
            label="Nome"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 120))}
            disabled={pending}
            className="min-w-64 flex-1"
          />
          <TextField
            select
            label="O que o modelo escreve"
            value={writes}
            onChange={(event) => setWrites(event.target.value === "procuracao" ? "procuracao" : "piece")}
            disabled={pending}
            className="min-w-56"
          >
            <MenuItem value="piece">{DOCUMENT_LABEL.piece}</MenuItem>
            <MenuItem value="procuracao">{DOCUMENT_LABEL.procuracao}</MenuItem>
          </TextField>
          {writes === "piece" ? (
            <TextField
              select
              label="Tipo de ação"
              value={kind}
              onChange={(event) => setKind(event.target.value as "juizado" | "comum" | "any")}
              disabled={pending}
              className="min-w-56"
            >
              <MenuItem value="any">{KIND_LABEL.any}</MenuItem>
              <MenuItem value="juizado">{KIND_LABEL.juizado}</MenuItem>
              <MenuItem value="comum">{KIND_LABEL.comum}</MenuItem>
            </TextField>
          ) : null}
        </Box>
        <Box className="flex flex-wrap gap-x-6">
          <FormControlLabel
            control={<Checkbox checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />}
            label={
              writes === "procuracao"
                ? "Procuração padrão para os escritórios sem procuração própria"
                : "Modelo padrão deste tipo para os escritórios sem modelo próprio"
            }
            disabled={pending}
          />
          <FormControlLabel
            control={<Checkbox checked={provisional} onChange={(event) => setProvisional(event.target.checked)} />}
            label="Provisório: o curador ainda não revisou"
            disabled={pending}
          />
        </Box>
        <TextField
          label="Texto"
          helperText={MARKS_HELP[writes]}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={pending}
          multiline
          minRows={16}
          maxRows={30}
          fullWidth
          slotProps={{ htmlInput: { spellCheck: true, lang: "pt-BR" } }}
        />
        <Refusal result={result} />
        <Box className="flex flex-wrap gap-2">
          <Button
            variant="contained"
            disabled={pending || name.trim().length < 2 || body.trim().length < 20}
            onClick={save}
          >
            {pending ? "Salvando" : "Salvar"}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function SourceDialog({
  source,
  onClose,
  onSaved,
}: {
  source: PlatformSource | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<string>(source?.kind ?? "lei");
  const [issuer, setIssuer] = useState(source?.issuer ?? "");
  const [number, setNumber] = useState(source?.number ?? "");
  const [article, setArticle] = useState(source?.article ?? "");
  const [title, setTitle] = useState(source?.title ?? "");
  const [quote, setQuote] = useState(source?.quote ?? "");
  const [sourceUrl, setSourceUrl] = useState(source?.sourceUrl ?? "");
  const [note, setNote] = useState(source?.note ?? "");
  const [result, setResult] = useState<ContentResult | null>(null);
  // What a source is (its kind, issuer, number and article) is said once: a correction is of its words.
  const fixed = source !== null;

  const save = () =>
    startTransition(async () => {
      const answer = await savePlatformSource({
        sourceId: source?.id ?? null,
        kind,
        issuer,
        number,
        article,
        title,
        quote,
        sourceUrl,
        note,
      });
      setResult(answer);
      if (answer.ok) onSaved();
    });

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      aria-labelledby="content-source-dialog"
      maxWidth="md"
      fullWidth
    >
      <DialogHeader
        id="content-source-dialog"
        title={source ? `Editar ${source.citation}` : "Nova fonte do ONE"}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-4 pt-2!">
        <Box className="flex flex-wrap gap-3">
          <TextField
            select
            label="Tipo"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            disabled={pending || fixed}
            className="min-w-48"
          >
            {LIBRARY_KINDS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Quem expediu"
            helperText="ANAC, STF, STJ, FONAJE"
            value={issuer}
            onChange={(event) => setIssuer(event.target.value.toUpperCase().slice(0, 12))}
            disabled={pending || fixed}
            className="w-40"
          />
          <TextField
            label="Número"
            helperText="8078, 5910/2006, 1240"
            value={number}
            onChange={(event) => setNumber(event.target.value.slice(0, 40))}
            disabled={pending || fixed}
            className="w-44"
          />
          <TextField
            label="Artigo"
            value={article}
            onChange={(event) => setArticle(event.target.value.toUpperCase().slice(0, 5))}
            disabled={pending || fixed}
            className="w-28"
          />
        </Box>
        <TextField
          label="Título"
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 300))}
          disabled={pending}
          fullWidth
        />
        <TextField
          label="Trecho, como a página oficial escreve"
          value={quote}
          onChange={(event) => setQuote(event.target.value.slice(0, 6000))}
          disabled={pending}
          multiline
          minRows={5}
          maxRows={14}
          fullWidth
        />
        <TextField
          label="Endereço da página oficial"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value.slice(0, 500))}
          disabled={pending}
          fullWidth
        />
        <TextField
          label="Observação"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 1000))}
          disabled={pending}
          fullWidth
        />
        <Refusal result={result} />
        <Box className="flex flex-wrap gap-2">
          <Button
            variant="contained"
            disabled={pending || title.trim().length < 3 || !sourceUrl.trim().startsWith("https://")}
            onClick={save}
          >
            {pending ? "Salvando" : "Salvar"}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
