/**
 * Database values as the operator reads them. The consoles are hardcoded pt-BR
 * (apps/web/CLAUDE.md): an enum, a slug or a status is always mapped to a word
 * here and never shown raw. `labelOf` falls back to the raw value, so a value
 * added by a migration shows up as itself instead of as nothing.
 */

export const labelOf = (labels: Record<string, string>, value: string | null | undefined, fallback = "—"): string =>
  value ? (labels[value] ?? value) : fallback;

export const LOCALE_LABEL: Record<string, string> = { "pt-BR": "Português" };

/** `org_role` (migration 0000): what a person may do to the firm account. */
export const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "titular da conta",
  admin: "administração",
  member: "equipe",
};

/** `firm_function` (migration 0000): what a person does in the firm. */
export const FIRM_FUNCTION_LABEL: Record<string, string> = {
  socio: "Sociedade",
  advogado: "Advocacia",
  controladoria: "Controladoria",
  atendimento: "Atendimento",
};

export const INVITATION_STATUS_LABEL: Record<string, string> = {
  open: "em aberto",
  accepted: "aceito",
  revoked: "cancelado",
  expired: "expirado",
};

/**
 * The rungs of the inherited billing ladder (migration 0004, rewritten in M3):
 * shown as what they are until tiers become data.
 */
export const TIER_LABEL: Record<string, string> = { kit: "Acesso", club: "Assinatura", pro: "Assinatura maior" };

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "ativa",
  trialing: "em teste",
  past_due: "inadimplente",
  incomplete: "incompleta",
  canceled: "cancelada",
};

export const PERIOD_LABEL: Record<string, string> = { monthly: "mensal", yearly: "anual", weekly: "semanal" };

export const PROVIDER_LABEL: Record<string, string> = { asaas: "Asaas", stripe: "Stripe (do produto anterior)" };

export const GRANT_KIND_LABEL: Record<string, string> = { kit: "acesso", license: "licença", comp: "cortesia" };

export const GRANT_SOURCE_LABEL: Record<string, string> = { purchase: "compra", admin: "concedido pela equipe" };

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  paid: "paga",
  open: "em aberto",
  failed: "falhou",
  refunded: "reembolsada",
  void: "anulada",
};

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  waitlist: "lista de espera",
  newsletter: "newsletter",
  contact: "contato",
};

export const CONSENT_SLUG_LABEL: Record<string, string> = {
  terms: "Termos de uso",
  privacy: "Política de privacidade",
  cookies: "Política de cookies",
  newsletter: "Avisos por e-mail",
};

export const CANCEL_REASON_LABEL: Record<string, string> = {
  too_expensive: "achou caro",
  not_using: "não está usando",
  missing_tool: "falta um recurso",
  switched: "trocou de solução",
  technical: "problema técnico",
  temporary: "pausa temporária",
  other: "outro motivo",
};
