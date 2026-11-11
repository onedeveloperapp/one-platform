/**
 * What a firm uses of its tier (migration 0202), the pure half: the panel's answer read into a plain shape, the share
 * of each ceiling, and the words of the bell when a firm nears one.
 */

export const USAGE_METRICS = ["processos_ativos", "assentos", "whatsapp_numeros"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export type UsageLine = { metric: UsageMetric; now: number; peak: number; ceiling: number | null };

export type UsagePanel = {
  tier: string | null;
  plan: {
    name: string;
    period: string | null;
    priceCents: number | null;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  metrics: UsageLine[];
  flightMonitor: boolean;
  alerts: { metric: UsageMetric; percent: number; value: number; ceiling: number; at: string }[];
};

const isMetric = (value: unknown): value is UsageMetric =>
  typeof value === "string" && (USAGE_METRICS as readonly string[]).includes(value);

const count = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** The panel as `firm_usage` answers it; null for an answer that is not one, or for who does not manage the firm. */
export function readUsagePanel(raw: unknown): UsagePanel | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (answer.ok !== true || answer.manages !== true) return null;
  const plan = answer.plan && typeof answer.plan === "object" ? (answer.plan as Record<string, unknown>) : null;
  return {
    tier: typeof answer.tier === "string" ? answer.tier : null,
    plan: plan
      ? {
          name: typeof plan.name === "string" ? plan.name : "",
          period: typeof plan.period === "string" ? plan.period : null,
          priceCents: plan.price_cents == null ? null : count(plan.price_cents),
          status: typeof plan.status === "string" ? plan.status : "",
          currentPeriodEnd: typeof plan.current_period_end === "string" ? plan.current_period_end : null,
        }
      : null,
    metrics: (Array.isArray(answer.metrics) ? answer.metrics : []).flatMap((row): UsageLine[] => {
      if (!row || typeof row !== "object") return [];
      const line = row as Record<string, unknown>;
      if (!isMetric(line.metric)) return [];
      const ceiling = count(line.ceiling);
      return [
        { metric: line.metric, now: count(line.now), peak: count(line.peak), ceiling: ceiling > 0 ? ceiling : null },
      ];
    }),
    flightMonitor: answer.flight_monitor === true,
    alerts: (Array.isArray(answer.alerts) ? answer.alerts : []).flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const alert = row as Record<string, unknown>;
      if (!isMetric(alert.metric) || typeof alert.at !== "string") return [];
      return [
        {
          metric: alert.metric,
          percent: count(alert.percent),
          value: count(alert.value),
          ceiling: count(alert.ceiling),
          at: alert.at,
        },
      ];
    }),
  };
}

/** The share of a ceiling a value is, whole; null with no ceiling. */
export const usagePercent = (line: Pick<UsageLine, "now" | "ceiling">): number | null =>
  line.ceiling ? Math.round((line.now * 100) / line.ceiling) : null;

/** What a firm's metric is called in a sentence, singular or plural. */
const METRIC_WORDS: Record<UsageMetric, [string, string]> = {
  processos_ativos: ["processo ativo", "processos ativos"],
  assentos: ["pessoa na equipe", "pessoas na equipe"],
  whatsapp_numeros: ["número de WhatsApp", "números de WhatsApp"],
};

export const metricWords = (metric: UsageMetric, n: number): string => METRIC_WORDS[metric][n === 1 ? 0 : 1];

/**
 * The bell of a firm nearing its tier's ceiling: what it reached and what to do. ONE never stops the firm's work for
 * it, and says so.
 */
export function usageAlertBell(alert: { metric: UsageMetric; percent: number; value: number; ceiling: number }): {
  title: string;
  body: string;
} {
  const reached = `${alert.value} de ${alert.ceiling} ${metricWords(alert.metric, alert.ceiling)}`;
  return alert.percent >= 100
    ? {
        title: "O escritório chegou ao limite da faixa",
        body: `${reached}. O ONE continua trabalhando normalmente; para seguir crescendo, mude de faixa em Cobrança.`,
      }
    : {
        title: `O escritório usa ${alert.percent}% da faixa`,
        body: `${reached}. Veja o consumo e as faixas em Cobrança.`,
      };
}
