"use client";

import { loadFirmDossier } from "../actions";
import FirmOperationSection from "./firm-operation";
import type { PersonAction, PersonTarget } from "./person-actions";
import TestFirmSection from "./test-firm-section";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import StatusChip from "@/components/product/status-chip";
import NiEllipsisVertical from "@/icons/nexture/ni-ellipsis-vertical";
import { type DossierPerson, type FirmDossier, isBanned } from "@/lib/admin/firms";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyByCurrency,
  formatNumber,
  sinceLabel,
} from "@/lib/admin/format";
import {
  CANCEL_REASON_LABEL,
  CONSENT_SLUG_LABEL,
  FIRM_FUNCTION_LABEL,
  GRANT_KIND_LABEL,
  GRANT_SOURCE_LABEL,
  INVITATION_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  labelOf,
  ORG_ROLE_LABEL,
  PERIOD_LABEL,
  PROVIDER_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  TIER_LABEL,
} from "@/lib/admin/labels";

/** What each limit of `org_entitlements` means, in the operator's words. Limits are data: an unknown key shows as itself. */
const LIMIT_LABEL: Record<string, string> = {
  assentos_max: "Lugares na equipe",
  processos_ativos_max: "Processos ativos",
  whatsapp_numeros_max: "Números de WhatsApp",
  monitor_voo: "Monitor de voo",
};

const SOURCE_LABEL: Record<string, string> = {
  free: "sem assinatura",
  grant: "acesso comprado ou cortesia",
  subscription: "assinatura",
  provisional: "Pix em confirmação",
};

/** The first touch of the firm (`signup_attribution`, migration 0006). */
const ATTRIBUTION_LABEL: Record<string, string> = {
  origem: "Porta de entrada",
  onda: "Onda",
  utm_source: "Fonte (utm_source)",
  utm_medium: "Meio (utm_medium)",
  utm_campaign: "Campanha (utm_campaign)",
  utm_content: "Conteúdo (utm_content)",
  utm_term: "Termo (utm_term)",
  referrer: "Página de origem",
  landing_path: "Primeira página visitada",
  captured_at: "Registrado em",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box component="section" className="flex flex-col gap-3">
      <Typography variant="h6" component="h3" className="mb-0">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A labelled fact. The grid keeps the labels aligned without a table. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <Box component="dl" className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <Box key={label} className="flex min-w-0 flex-col">
          <Typography component="dt" variant="body2" className="text-text-secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="body1" className="m-0 break-words">
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** A list row with one line of facts under its title. */
function Line({ title, detail, trailing }: { title: string; detail: string; trailing?: React.ReactNode }) {
  return (
    <Box className="border-grey-100 flex flex-row items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
      <Box className="flex min-w-0 flex-col">
        <Typography variant="subtitle2" component="p" className="break-words">
          {title}
        </Typography>
        <Typography variant="body2" className="text-text-secondary break-words">
          {detail}
        </Typography>
      </Box>
      {trailing ? <Box className="flex flex-none flex-row items-center gap-1.5">{trailing}</Box> : null}
    </Box>
  );
}

const Nothing = ({ children }: { children: string }) => (
  <Typography variant="body1" className="text-text-secondary">
    {children}
  </Typography>
);

const limitValue = (value: unknown): string => {
  if (typeof value === "number") return formatNumber(value);
  return value === null || value === undefined ? "não definido" : String(value);
};

const personName = (person: Pick<DossierPerson, "name" | "email">) => person.name ?? person.email ?? "Conta sem nome";

const oabLabel = (entry: { uf: string; number: string }) => `OAB/${entry.uf} ${entry.number}`;

/**
 * Everything the platform knows about the ACCOUNT of one firm, in the order a
 * support call asks for it: who is in it, what it may use, what it paid, what
 * its people agreed to and whether they sign in. Nothing here is what the firm
 * keeps in the product.
 */
export function FirmDossierBody({
  dossier,
  onPersonMenu,
}: {
  dossier: FirmDossier;
  /** Opens the actions of one person; absent where the dossier is read-only. */
  onPersonMenu?: (anchor: HTMLElement, person: DossierPerson) => void;
}) {
  const { firm, money, team } = dossier;
  const entitlements = dossier.entitlements;
  const limits = Object.entries(entitlements?.limits ?? {});
  const attribution = Object.entries(dossier.attribution ?? {}).filter(([, value]) => value);
  const names = new Map(team.map((person) => [person.userId, personName(person)]));

  return (
    <Box className="flex flex-col gap-8">
      <Section title="Escritório">
        <Facts
          rows={[
            ["Fundado em", formatDate(firm.createdAt)],
            [
              "Documento fiscal",
              firm.billingDocument
                ? `${firm.billingDocument.kind.toUpperCase()} terminado em ${firm.billingDocument.lastDigits}`
                : "não informado",
            ],
            ["Pessoas na equipe", formatNumber(team.length)],
            ["Com inscrição na OAB", formatNumber(team.filter((person) => person.oab.length > 0).length)],
          ]}
        />
      </Section>

      <FirmOperationSection orgId={firm.orgId} />

      <TestFirmSection orgId={firm.orgId} />

      <Section title="Equipe">
        {team.length === 0 ? (
          <Nothing>Nenhuma pessoa: um escritório sempre deveria ter ao menos o titular.</Nothing>
        ) : (
          <Box className="flex flex-col gap-2">
            {team.map((person) => (
              <Line
                key={person.userId}
                title={personName(person)}
                detail={[
                  person.email ?? "sem e-mail",
                  labelOf(FIRM_FUNCTION_LABEL, person.firmFunction),
                  person.oab.length > 0 ? person.oab.map(oabLabel).join(", ") : null,
                  person.twoFactor ? "segundo fator ativo" : "sem segundo fator",
                  person.confirmed ? null : "e-mail não confirmado",
                  person.lastSignInAt ? `entrou ${sinceLabel(person.lastSignInAt)}` : "nunca entrou",
                  `na equipe desde ${formatDate(person.joinedAt)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <>
                    {isBanned(person.bannedUntil) ? <StatusChip label="bloqueada" tone="danger" /> : null}
                    {person.isSuperadmin ? <StatusChip label="superadmin" tone="info" /> : null}
                    <StatusChip
                      label={labelOf(ORG_ROLE_LABEL, person.role)}
                      tone={person.role === "owner" ? "primary" : "neutral"}
                    />
                    {onPersonMenu ? (
                      <IconButton
                        size="small"
                        color="grey"
                        aria-label={`Ações para ${personName(person)}`}
                        onClick={(event) => onPersonMenu(event.currentTarget, person)}
                      >
                        <NiEllipsisVertical size="medium" />
                      </IconButton>
                    ) : null}
                  </>
                }
              />
            ))}
          </Box>
        )}
      </Section>

      <Section title="Convites">
        {dossier.invitations.length === 0 ? (
          <Nothing>Nenhum convite enviado até hoje.</Nothing>
        ) : (
          <Box className="flex flex-col gap-2">
            {dossier.invitations.map((invitation) => (
              <Line
                key={invitation.id}
                title={invitation.email}
                detail={[
                  labelOf(FIRM_FUNCTION_LABEL, invitation.firmFunction),
                  invitation.role === "admin" ? "com a administração" : null,
                  `enviado em ${formatDate(invitation.createdAt)}`,
                  invitation.status === "open" ? `vale até ${formatDate(invitation.expiresAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <StatusChip
                    label={labelOf(INVITATION_STATUS_LABEL, invitation.status)}
                    tone={
                      invitation.status === "open"
                        ? "attention"
                        : invitation.status === "accepted"
                          ? "positive"
                          : "neutral"
                    }
                  />
                }
              />
            ))}
          </Box>
        )}
      </Section>

      <Section title="O que o escritório pode usar">
        <Facts
          rows={[
            ["Faixa", entitlements?.tier ? labelOf(TIER_LABEL, entitlements.tier) : "sem plano"],
            [
              "Vem de",
              (entitlements?.sources ?? [])
                .map((source) => labelOf(SOURCE_LABEL, source.type))
                .filter((value, index, all) => all.indexOf(value) === index)
                .join(", ") || "nenhuma fonte",
            ],
            ...limits.map(([key, value]): [string, string] => [LIMIT_LABEL[key] ?? key, limitValue(value)]),
          ]}
        />
        {entitlements?.suspended ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            Acesso suspenso pela equipe da plataforma: nada é liberado enquanto a suspensão durar, mesmo com a
            assinatura paga.
          </Alert>
        ) : null}
      </Section>

      <Section title="Dinheiro">
        <Facts
          rows={[
            ["Pago até hoje", formatMoneyByCurrency(money.paid)],
            ["Reembolsado", formatMoneyByCurrency(money.refunded)],
          ]}
        />
        {money.subscriptions.length === 0 && money.grants.length === 0 ? (
          <Nothing>Nenhuma compra e nenhuma assinatura.</Nothing>
        ) : (
          <Box className="flex flex-col gap-2">
            {money.subscriptions.map((subscription) => (
              <Line
                key={subscription.id}
                title={`${subscription.plan}${subscription.period ? ` ${labelOf(PERIOD_LABEL, subscription.period)}` : ""}`}
                detail={[
                  subscription.priceCents
                    ? formatMoney(subscription.priceCents, subscription.currency)
                    : "sem cobrança",
                  subscription.provider ? labelOf(PROVIDER_LABEL, subscription.provider) : "sem provedor de pagamento",
                  subscription.coupon ? `cupom ${subscription.coupon}` : null,
                  `desde ${formatDate(subscription.createdAt)}`,
                  subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd
                    ? `cancela em ${formatDate(subscription.currentPeriodEnd)}`
                    : null,
                  subscription.canceledAt ? `cancelada em ${formatDate(subscription.canceledAt)}` : null,
                  subscription.cancelReason
                    ? `motivo: ${labelOf(CANCEL_REASON_LABEL, subscription.cancelReason)}${subscription.cancelNote ? ` (${subscription.cancelNote})` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <StatusChip
                    label={
                      subscription.suspended ? "suspensa" : labelOf(SUBSCRIPTION_STATUS_LABEL, subscription.status)
                    }
                    tone={
                      subscription.suspended || subscription.status === "past_due"
                        ? "attention"
                        : subscription.status === "active"
                          ? "positive"
                          : "neutral"
                    }
                  />
                }
              />
            ))}
            {money.grants.map((grant) => (
              <Line
                key={grant.id}
                title={`${labelOf(GRANT_KIND_LABEL, grant.kind)}${grant.plan ? ` (${grant.plan})` : ""}`}
                detail={[
                  labelOf(GRANT_SOURCE_LABEL, grant.source),
                  grant.priceCents ? formatMoney(grant.priceCents, grant.currency) : null,
                  `em ${formatDate(grant.createdAt)}`,
                  grant.expiresAt ? `vale até ${formatDate(grant.expiresAt)}` : "sem vencimento",
                  grant.note,
                  grant.revokedAt
                    ? `revogado em ${formatDate(grant.revokedAt)}${grant.revokeReason ? `: ${grant.revokeReason}` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <StatusChip
                    label={grant.revokedAt ? "revogado" : "vale"}
                    tone={grant.revokedAt ? "neutral" : "positive"}
                  />
                }
              />
            ))}
          </Box>
        )}
        {money.invoices.length > 0 ? (
          <Box className="flex flex-col gap-2">
            <Typography variant="subtitle2" component="h4">
              Últimas faturas
            </Typography>
            {money.invoices.map((invoice) => (
              <Line
                key={invoice.id}
                title={formatMoney(invoice.amountCents, invoice.currency)}
                detail={[
                  invoice.paidAt
                    ? `paga em ${formatDate(invoice.paidAt)}`
                    : `criada em ${formatDate(invoice.createdAt)}`,
                  invoice.provider ? labelOf(PROVIDER_LABEL, invoice.provider) : null,
                  invoice.hasFiscalDocument ? "com nota fiscal" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <StatusChip
                    label={labelOf(INVOICE_STATUS_LABEL, invoice.status)}
                    tone={invoice.status === "paid" ? "positive" : invoice.status === "failed" ? "danger" : "neutral"}
                  />
                }
              />
            ))}
          </Box>
        ) : null}
      </Section>

      <Section title="Termos e acessos">
        {dossier.consent.length === 0 ? (
          <Nothing>Nenhum aceite de termos registrado pelas pessoas da equipe.</Nothing>
        ) : (
          <Box className="flex flex-col gap-2">
            {dossier.consent.map((entry) => (
              <Line
                key={`${entry.userId}-${entry.slug}-${entry.version}`}
                title={`${labelOf(CONSENT_SLUG_LABEL, entry.slug)}, versão ${entry.version}`}
                detail={`${names.get(entry.userId) ?? "pessoa da equipe"} · aceito em ${formatDateTime(entry.acceptedAt)}${entry.revokedAt ? ` · retirado em ${formatDate(entry.revokedAt)}` : ""}`}
              />
            ))}
          </Box>
        )}
        <Facts
          rows={[
            ["Logins da equipe em 30 dias", formatNumber(dossier.access.signIns30d)],
            ["Sessões de suporte recebidas", formatNumber(dossier.access.supportVisits)],
          ]}
        />
      </Section>

      {attribution.length > 0 ? (
        <Section title="De onde veio">
          <Facts
            rows={attribution.map(([key, value]): [string, string] => [
              ATTRIBUTION_LABEL[key] ?? key,
              key === "captured_at" ? formatDateTime(String(value)) : String(value),
            ])}
          />
        </Section>
      ) : null}
    </Box>
  );
}

type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; dossier: FirmDossier };

/**
 * The dossier of one firm, read when it is opened. Mounted only while open and
 * keyed by the firm, so one firm's data never shows under another's name. The
 * escalated actions (support access, block, second-factor reset, deletion) act
 * on a PERSON, so each person of the team carries their own menu.
 */
export default function FirmDossierDialog({
  orgId,
  name,
  preloaded,
  listActions,
  onClose,
}: {
  orgId: string;
  name: string;
  /** A dossier already in hand (fixtures): skips the read. */
  preloaded?: FirmDossier;
  listActions: (target: PersonTarget) => PersonAction[];
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>(
    preloaded ? { kind: "ready", dossier: preloaded } : { kind: "loading" },
  );
  const [menu, setMenu] = useState<{ anchor: HTMLElement; person: DossierPerson } | null>(null);

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    loadFirmDossier(orgId).then(
      (result) => {
        if (cancelled) return;
        setState(result.ok ? { kind: "ready", dossier: result } : { kind: "error" });
      },
      () => {
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, preloaded]);

  const dossier = state.kind === "ready" ? state.dossier : null;
  const menuActions = menu
    ? listActions({
        userId: menu.person.userId,
        orgId,
        name: personName(menu.person),
        email: menu.person.email,
        isSuperadmin: menu.person.isSuperadmin,
        hasMfa: menu.person.twoFactor,
        banned: isBanned(menu.person.bannedUntil),
      })
    : [];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth scroll="paper" aria-labelledby="firm-dossier-title">
      <DialogHeader
        id="firm-dossier-title"
        title={name}
        onClose={onClose}
        closeLabel="Fechar o dossiê"
        trailing={
          dossier ? (
            <StatusChip
              label={dossier.entitlements?.tier ? labelOf(TIER_LABEL, dossier.entitlements.tier) : "sem plano"}
              tone={dossier.entitlements?.tier ? "primary" : "neutral"}
            />
          ) : null
        }
      />
      <DialogContent dividers>
        {state.kind === "loading" ? (
          <Box className="flex min-h-40 items-center gap-3">
            <CircularProgress size={20} aria-label="Carregando" />
            <Typography variant="body1" className="text-text-secondary">
              Lendo o que a plataforma sabe da conta deste escritório…
            </Typography>
          </Box>
        ) : state.kind === "error" ? (
          // A failed read is an error, never a firm that looks empty.
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Não foi possível ler o dossiê deste escritório. Feche e abra de novo; se continuar, confira se a sua sessão
            ainda tem o papel de superadmin.
          </Alert>
        ) : (
          <FirmDossierBody dossier={state.dossier} onPersonMenu={(anchor, person) => setMenu({ anchor, person })} />
        )}
      </DialogContent>
      <DialogActions disableSpacing className="flex-wrap gap-2">
        <Button variant="text" color="grey" component={Link} href="/admin/billing" className="whitespace-nowrap">
          Abrir faturamento
        </Button>
        <Button variant="contained" onClick={onClose} className="whitespace-nowrap">
          Fechar
        </Button>
      </DialogActions>

      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menuActions.length === 0 ? (
          <MenuItem disabled>Nenhuma ação disponível para esta pessoa</MenuItem>
        ) : (
          menuActions.map((action) => (
            <MenuItem
              key={action.key}
              onClick={() => {
                setMenu(null);
                action.run();
              }}
            >
              <ListItemIcon>{action.icon}</ListItemIcon>
              <ListItemText primary={action.label} />
            </MenuItem>
          ))
        )}
      </Menu>
    </Dialog>
  );
}
