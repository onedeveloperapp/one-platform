import { evidenceTimeline, readEvidenceKit, spanWords, takenInstant } from "./evidence-moments";
import { describe, expect, it } from "vitest";

const RAW = {
  ok: true,
  legs: [
    {
      position: 1,
      flight: "LA3456",
      origin: "GYN",
      destination: "GRU",
      affected: true,
      departure_at: "2099-10-22T11:10:00+00:00",
      arrival_at: "2099-10-22T12:55:00+00:00",
      actual_arrival_at: null,
    },
  ],
  alerts: [{ kind: "delayed", delay_minutes: 240, sent_at: "2099-10-22T11:40:00+00:00" }],
  proofs: [
    {
      id: "a2090000-0000-4000-8000-0000000000d1",
      kind: "evidence",
      source: "client",
      status: "received",
      person: "Maria Teste",
      received_at: "2099-10-22T12:05:00+00:00",
      taken_local: "2099-10-22T09:03:10",
      taken_offset: "-03:00",
      sha256: "a".repeat(64),
    },
    {
      id: "a2090000-0000-4000-8000-0000000000d2",
      kind: "receipt",
      source: "whatsapp",
      status: "accepted",
      person: "Maria Teste",
      received_at: "2099-10-22T15:30:00+00:00",
      taken_local: null,
      taken_offset: null,
      sha256: "b".repeat(64),
    },
    { id: "x", kind: "evidence", received_at: "not a moment" },
  ],
};

const KIND: Record<string, string> = { evidence: "Prova do problema", receipt: "Recibo" };

describe("the evidence kit (0209)", () => {
  it("reads the database's answer, leaving out what has no moment", () => {
    const kit = readEvidenceKit(RAW);
    expect(kit?.legs).toHaveLength(1);
    expect(kit?.alerts[0]).toEqual({ kind: "delayed", delayMinutes: 240, sentAt: "2099-10-22T11:40:00+00:00" });
    expect(kit?.proofs.map((proof) => proof.kind)).toEqual(["evidence", "receipt"]);
    expect(readEvidenceKit({ ok: false, code: "not_found" })).toBeNull();
  });

  it("says a span of time as people say it", () => {
    expect(spanWords(55)).toBe("55 minutos");
    expect(spanWords(60)).toBe("1 hora");
    expect(spanWords(125)).toBe("2 horas e 5 minutos");
    expect(spanWords(-61)).toBe("1 hora e 1 minuto");
    expect(spanWords(3 * 24 * 60)).toBe("3 dias");
  });

  it("turns a device's moment into an instant only when the device wrote its offset", () => {
    expect(takenInstant("2099-10-22T09:03:10", "-03:00")).toBe("2099-10-22T12:03:10.000Z");
    expect(takenInstant("2099-10-22T09:03:10", null)).toBeNull();
    expect(takenInstant(null, "-03:00")).toBeNull();
  });

  it("lays the kit out in the order things happened, each proof against the departure", () => {
    const lines = evidenceTimeline(readEvidenceKit(RAW)!, (kind) => KIND[kind] ?? kind);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/08:10: partida prevista do voo LA 3456 de GYN para GRU$/);
    expect(lines[1]).toMatch(/08:40: o ONE avisou o passageiro pelo WhatsApp sobre o atraso, de 4 horas na chegada$/);
    expect(lines[2]).toMatch(/09:05: chegou ao ONE prova do problema de Maria Teste, enviada pelo cliente no link/);
    expect(lines[2]).toContain("55 minutos depois da partida prevista do voo LA 3456");
    expect(lines[2]).toMatch(
      /a foto diz que foi tirada em 22\/10\/2099,? 09:03 \(horário de Brasília\), pelo relógio do aparelho/,
    );
    expect(lines[2]).toContain(`impressão digital do arquivo ${"a".repeat(16)}`);
    expect(lines[3]).toMatch(/09:55: chegada prevista do voo LA 3456 a GRU$/);
    // A file that says nothing of when it was made is said so.
    const receipt = evidenceTimeline(readEvidenceKit(RAW)!, (kind) => KIND[kind] ?? kind).find((line) =>
      line.includes("recibo"),
    );
    expect(receipt).toContain("enviada pelo cliente na conversa do WhatsApp, 4 horas e 20 minutos depois");
    expect(receipt).toContain("o arquivo não diz quando foi feito");
  });

  it("writes a device's moment as it is when the device wrote no offset", () => {
    const raw = structuredClone(RAW);
    raw.proofs[0]!.taken_offset = null;
    const lines = evidenceTimeline(readEvidenceKit(raw)!, (kind) => KIND[kind] ?? kind);
    expect(lines.find((line) => line.includes("prova do problema"))).toContain(
      "a foto diz que foi tirada em 22/10/2099 às 09:03, na hora do aparelho",
    );
  });
});
