"use client";

import { discardModuleVersion, draftModuleVersion, publishModuleVersion, withdrawModuleVersion } from "./actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationPlatforms from "@/icons/illustrations/illustration-platforms";
import NiCatalog from "@/icons/nexture/ni-catalog";
import {
  latestPublished,
  type ManifestChange,
  manifestChanges,
  type ModuleVersionRow,
  type ModuleVersions,
} from "@/lib/admin/module-versions";
import type { ConsoleState } from "@/lib/admin/session";

type State = ConsoleState<{ modules: ModuleVersions[] }>;

const PROBLEM: Record<string, string> = { default: "todos os problemas", baggage: "bagagem" };

const FAILURE: Record<string, string> = {
  forbidden: "Só o operador mexe nas versões.",
  not_found: "Essa versão não existe mais.",
  not_a_draft: "Essa versão já não é um rascunho.",
  not_published: "Essa versão não está publicada.",
  last_published: "Esta é a única versão publicada do módulo: os casos ficariam sem nenhuma para ler.",
  invalid_data: "Escreva de 3 a 1.000 caracteres.",
};

/** A change between two manifests, in the operator's words. */
function changeWords(change: ManifestChange): string {
  switch (change.area) {
    case "documents":
      return `Documentos pedidos em ${PROBLEM[change.key] ?? change.key}`;
    case "prompts":
      return change.from === null
        ? `Instruções de ${change.key}: passam a ser fixadas na versão ${change.to}`
        : change.to === null
          ? `Instruções de ${change.key}: deixam de ser fixadas (era a versão ${change.from})`
          : `Instruções de ${change.key}: da versão ${change.from} para a ${change.to}`;
    case "templates":
      return change.what === "added"
        ? `Modelo da plataforma novo: ${change.name}`
        : change.what === "removed"
          ? `Modelo da plataforma removido: ${change.name}`
          : change.what === "text"
            ? `Modelo da plataforma com texto novo: ${change.name}`
            : `Modelo da plataforma com nome novo: ${change.name}`;
    case "kinds":
      return change.what === "added"
        ? `Peça nova: ${change.name}`
        : change.what === "removed"
          ? `Peça removida: ${change.name}`
          : `Modelo da peça com texto novo: ${change.name}`;
  }
}

const day = (value: string | null): string | null =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : null;

type Pending =
  | { kind: "draft"; module: ModuleVersions; next: number }
  | { kind: "publish"; module: ModuleVersions; version: ModuleVersionRow }
  | { kind: "withdraw"; module: ModuleVersions; version: ModuleVersionRow };

/**
 * /admin/modulos (migration 0212): each module's version in force, what changed since it in what is in force now,
 * the draft of the next version with its publication, and every version with how many cases it carries, a
 * published one withdrawn with its reason. What a version holds is what the module's cases read.
 */
export default function ModulesConsoleView({ state }: { state: State }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const header = (
    <PageHeader
      title="Versões dos módulos"
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Versões dos módulos" }]}
      description="O que os casos de cada módulo leem: os documentos por problema, a versão de cada instrução da IA e os modelos da plataforma. Cada caso segue a versão em que foi aberto."
    />
  );

  if (state.kind !== "ready") {
    return (
      <Box className="flex flex-col gap-5">
        {header}
        <Alert severity={state.kind === "error" ? "error" : "info"} className="neutral bg-background-paper/60!">
          {state.kind === "error"
            ? "Não foi possível ler as versões agora."
            : "O console não está disponível nesta sessão."}
        </Alert>
      </Box>
    );
  }

  const open = (next: Pending) => {
    setPending(next);
    setText("");
    setProblem(null);
  };

  const act = async () => {
    if (!pending) return;
    setBusy(true);
    setProblem(null);
    const answer =
      pending.kind === "draft"
        ? await draftModuleVersion(pending.module.key, text)
        : pending.kind === "publish"
          ? await publishModuleVersion(pending.version.id)
          : await withdrawModuleVersion(pending.version.id, text);
    setBusy(false);
    if (!answer.ok) {
      setProblem(FAILURE[answer.code] ?? "Não foi possível agora. Tente de novo.");
      return;
    }
    setDone(
      pending.kind === "draft"
        ? `Rascunho da versão ${pending.next} de ${pending.module.name} preparado.`
        : pending.kind === "publish"
          ? `Versão ${pending.version.version} de ${pending.module.name} publicada: os casos abertos a partir de agora seguem esta versão.`
          : `Versão ${pending.version.version} de ${pending.module.name} retirada: os casos dela seguem a última publicada.`,
    );
    setPending(null);
    router.refresh();
  };

  const discard = async (version: ModuleVersionRow) => {
    setBusy(true);
    const answer = await discardModuleVersion(version.id);
    setBusy(false);
    if (!answer.ok) setDone(FAILURE[answer.code] ?? "Não foi possível descartar agora.");
    else {
      setDone(`Rascunho da versão ${version.version} descartado.`);
      router.refresh();
    }
  };

  return (
    <Box className="flex flex-col gap-5">
      {header}
      {done ? (
        <Alert severity="success" onClose={() => setDone(null)}>
          {done}
        </Alert>
      ) : null}
      {state.modules.length === 0 ? (
        <EmptyState
          icon={<NiCatalog size="large" />}
          illustration={<IllustrationPlatforms />}
          title="Nenhum módulo em oferta"
          description="As versões aparecem aqui quando houver um módulo que os escritórios possam contratar."
        />
      ) : null}
      {state.modules.map((module) => {
        const current = latestPublished(module);
        const draft = module.versions.find((version) => version.status === "draft") ?? null;
        const sinceCurrent = manifestChanges(current?.manifest ?? null, module.now);
        const draftChanges = draft ? manifestChanges(current?.manifest ?? null, draft.manifest) : [];
        const staleDraft = draft ? manifestChanges(draft.manifest, module.now).length > 0 : false;
        const next = (module.versions[0]?.version ?? 0) + 1;
        const published = module.versions.filter((version) => version.status === "published").length;
        return (
          <Card key={module.key} component="section" aria-labelledby={`module-${module.key}`}>
            <CardContent className="flex flex-col gap-4">
              <CardTitle
                id={`module-${module.key}`}
                icon={<NiCatalog size="medium" />}
                tone="primary"
                title={module.name}
                description="Os casos novos são abertos na última versão publicada; os casos em andamento ficam na deles, a não ser que ela seja retirada."
                chip={
                  current ? (
                    <StatusChip label={`Versão ${current.version} em vigor`} tone="positive" />
                  ) : (
                    <StatusChip label="Nenhuma versão publicada" tone="attention" />
                  )
                }
              />

              {draft ? (
                <Box className="flex flex-col gap-2">
                  <Typography variant="subtitle2" component="h3">
                    {`Rascunho da versão ${draft.version}`}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {draft.note}
                  </Typography>
                  {draftChanges.length > 0 ? (
                    <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                      {draftChanges.map((change) => (
                        <Box component="li" key={`${change.area}-${change.key}`}>
                          <StateLine tone="info">{changeWords(change)}</StateLine>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <StateLine tone="info">Igual à versão em vigor.</StateLine>
                  )}
                  {staleDraft ? (
                    <StateLine
                      tone="attention"
                      action={
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={busy}
                          onClick={() => open({ kind: "draft", module, next: draft.version })}
                        >
                          Preparar de novo
                        </Button>
                      }
                    >
                      O que está em vigor mudou depois deste rascunho.
                    </StateLine>
                  ) : null}
                  <Box className="flex flex-wrap gap-2">
                    <Button
                      variant="contained"
                      disabled={busy}
                      onClick={() => open({ kind: "publish", module, version: draft })}
                    >
                      {`Publicar a versão ${draft.version}`}
                    </Button>
                    <Button variant="text" color="grey" disabled={busy} onClick={() => void discard(draft)}>
                      Descartar
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Box className="flex flex-col gap-2">
                  <Typography variant="subtitle2" component="h3">
                    {current ? `O que mudou desde a versão ${current.version}` : "O que está em vigor"}
                  </Typography>
                  {sinceCurrent.length > 0 ? (
                    <>
                      <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                        {sinceCurrent.map((change) => (
                          <Box component="li" key={`${change.area}-${change.key}`}>
                            <StateLine tone="attention">{changeWords(change)}</StateLine>
                          </Box>
                        ))}
                      </Box>
                      <Box>
                        <Button
                          variant="contained"
                          disabled={busy}
                          onClick={() => open({ kind: "draft", module, next })}
                        >
                          {`Preparar a versão ${next}`}
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <StateLine tone="done">{`Nada mudou desde a versão ${current?.version ?? 1}.`}</StateLine>
                  )}
                </Box>
              )}

              <Box className="flex flex-col gap-2">
                <Typography variant="subtitle2" component="h3">
                  Versões
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {module.versions
                    .filter((version) => version.status !== "draft")
                    .map((version) => {
                      const inForce = current?.id === version.id;
                      const status = version.status === "withdrawn" ? "Retirada" : inForce ? "Em vigor" : "Publicada";
                      return (
                        <Box component="li" key={version.id}>
                          <StateLine
                            tone={version.status === "withdrawn" ? "failed" : inForce ? "done" : "info"}
                            status={status}
                            action={
                              version.status === "published" && published > 1 ? (
                                <Button
                                  size="small"
                                  variant="text"
                                  color="grey"
                                  disabled={busy}
                                  onClick={() => open({ kind: "withdraw", module, version })}
                                >
                                  Retirar
                                </Button>
                              ) : undefined
                            }
                          >
                            <span className="font-semibold">{`Versão ${version.version}`}</span>
                            <Typography variant="caption" component="span" className="text-text-secondary block">
                              {[
                                version.note,
                                day(version.publishedAt) ? `publicada em ${day(version.publishedAt)}` : null,
                                `${version.cases} ${version.cases === 1 ? "caso" : "casos"}, ${version.openCases} em andamento`,
                                version.withdrawReason ? `retirada: ${version.withdrawReason}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography>
                          </StateLine>
                        </Box>
                      );
                    })}
                </Box>
              </Box>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={pending !== null} onClose={() => (busy ? null : setPending(null))} fullWidth maxWidth="sm">
        {pending ? (
          <>
            <DialogHeader
              title={
                pending.kind === "draft"
                  ? `Preparar a versão ${pending.next} de ${pending.module.name}`
                  : pending.kind === "publish"
                    ? `Publicar a versão ${pending.version.version}`
                    : `Retirar a versão ${pending.version.version}`
              }
              onClose={() => setPending(null)}
              closeLabel="Fechar"
            />
            <DialogContent className="flex flex-col gap-3">
              {pending.kind === "publish" ? (
                <>
                  <StateLine tone="info">Os casos abertos a partir de agora seguem esta versão.</StateLine>
                  <StateLine tone="info">Os casos em andamento continuam na versão em que foram abertos.</StateLine>
                  <StateLine tone="info">
                    Depois de publicada, a versão não muda mais: uma mudança é outra versão.
                  </StateLine>
                </>
              ) : pending.kind === "withdraw" ? (
                <>
                  <StateLine tone="attention">
                    {`Os ${pending.version.openCases} casos em andamento desta versão passam a seguir a última publicada.`}
                  </StateLine>
                  <TextField
                    label="Por que retirar"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    multiline
                    minRows={2}
                    slotProps={{ htmlInput: { maxLength: 1000 } }}
                  />
                </>
              ) : (
                <>
                  <Typography variant="body2" className="text-text-secondary">
                    O rascunho guarda o que está em vigor agora. Ele só vale para os casos depois de publicado.
                  </Typography>
                  <TextField
                    label="O que muda nesta versão"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    multiline
                    minRows={2}
                    slotProps={{ htmlInput: { maxLength: 1000 } }}
                  />
                </>
              )}
              {problem ? <Alert severity="error">{problem}</Alert> : null}
            </DialogContent>
            <DialogActions>
              <Button variant="text" color="grey" disabled={busy} onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button
                variant="contained"
                color={pending.kind === "withdraw" ? "error" : "primary"}
                disabled={busy || (pending.kind !== "publish" && text.trim().length < 3)}
                onClick={() => void act()}
              >
                {pending.kind === "draft" ? "Preparar" : pending.kind === "publish" ? "Publicar" : "Retirar"}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Box>
  );
}
