import { readUsagePanel, usageAlertBell, usagePercent } from "./billing-usage";
import { describe, expect, it } from "vitest";

describe("what a firm uses of its tier", () => {
  it("reads the panel only for who manages the firm, leaving out a metric it does not know", () => {
    const panel = readUsagePanel({
      ok: true,
      manages: true,
      tier: "escritorio",
      plan: { name: "Escritório", period: "monthly", price_cents: 99000, status: "active" },
      metrics: [
        { metric: "processos_ativos", now: 240, peak: 251, ceiling: 300 },
        { metric: "assentos", now: 4, peak: 4, ceiling: null },
        { metric: "inventado", now: 1, peak: 1, ceiling: 2 },
      ],
      flight_monitor: true,
      alerts: [{ metric: "processos_ativos", percent: 80, value: 240, ceiling: 300, at: "2026-11-10T12:00:00Z" }],
    });
    expect(panel?.plan?.name).toBe("Escritório");
    expect(panel?.metrics).toEqual([
      { metric: "processos_ativos", now: 240, peak: 251, ceiling: 300 },
      { metric: "assentos", now: 4, peak: 4, ceiling: null },
    ]);
    expect(panel?.flightMonitor).toBe(true);
    expect(panel?.alerts).toHaveLength(1);
    expect(readUsagePanel({ ok: true, manages: false })).toBeNull();
    expect(readUsagePanel(null)).toBeNull();
  });

  it("measures the share of a ceiling, and none without one", () => {
    expect(usagePercent({ now: 240, ceiling: 300 })).toBe(80);
    expect(usagePercent({ now: 4, ceiling: null })).toBeNull();
  });

  it("tells the bell what was reached, and that ONE never stops at the ceiling", () => {
    const near = usageAlertBell({ metric: "processos_ativos", percent: 80, value: 240, ceiling: 300 });
    expect(near.title).toBe("O escritório usa 80% da faixa");
    expect(near.body).toContain("240 de 300 processos ativos");
    const full = usageAlertBell({ metric: "whatsapp_numeros", percent: 100, value: 1, ceiling: 1 });
    expect(full.title).toBe("O escritório chegou ao limite da faixa");
    expect(full.body).toContain("1 de 1 número de WhatsApp");
    expect(full.body).toContain("continua trabalhando");
    for (const text of [near.title, near.body, full.title, full.body]) {
      expect(text).not.toMatch(/[—–!]/);
    }
  });
});
