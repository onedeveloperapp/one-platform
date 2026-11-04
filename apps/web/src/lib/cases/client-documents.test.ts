// @vitest-environment node
import { describe, expect, it } from "vitest";

import { documentNeeds, type PersonData } from "@/lib/cases/cases";
import { documentsStanding, extraDocuments, isOwed, latestRefusal, needStanding } from "@/lib/cases/client-documents";

// Invented people of an invented case.
const person = (person_id: string, party_id: string, full_name: string): PersonData => ({
  person_id,
  party_id,
  full_name,
  cpf: null,
  birth_date: null,
  nationality: null,
  marital_status: null,
  profession: null,
  email: null,
  phone: null,
  postal_code: null,
  street: null,
  address_number: null,
  complement: null,
  district: null,
  city: null,
  uf: null,
});
const holder = person("p-ana", "party-ana", "Ana Teste");
const child = person("p-leo", "party-leo", "Leo Teste");
const needs = documentNeeds({
  holder,
  claimants: [holder, child],
  required: [
    { kind: "identity", per: "claimant" },
    { kind: "address_proof", per: "holder" },
    { kind: "ticket", per: "case", or: ["boarding_pass"] },
  ],
});

const doc = (kind: string, party_id: string | null, status: string, created_at = "2026-11-03T10:00:00Z") => ({
  kind,
  party_id,
  status,
  created_at,
});

describe("needStanding", () => {
  it("is accepted once the firm accepted one, whatever else came", () => {
    expect(needStanding([doc("identity", "party-ana", "rejected"), doc("identity", "party-ana", "accepted")])).toBe(
      "accepted",
    );
  });
  it("is received while one waits for the firm, after a refusal too", () => {
    expect(needStanding([doc("identity", "party-ana", "rejected"), doc("identity", "party-ana", "received")])).toBe(
      "received",
    );
  });
  it("is rejected when all that came was refused, and missing when nothing came", () => {
    expect(needStanding([doc("identity", "party-ana", "rejected")])).toBe("rejected");
    expect(needStanding([])).toBe("missing");
  });
  it("owes a file only while nothing sent serves", () => {
    expect(["accepted", "received", "rejected", "missing"].map((s) => isOwed(s as never))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe("documentsStanding", () => {
  it("counts what is still owed: nothing sent, or only refused", () => {
    const documents = [
      doc("identity", "party-ana", "accepted"),
      doc("identity", "party-leo", "rejected"),
      doc("ticket", null, "received"),
    ];
    expect(documentsStanding(needs, documents)).toEqual({ state: "owed", owed: 2 });
  });
  it("is checking once each need has one and the firm has not decided every one", () => {
    const documents = [
      doc("identity", "party-ana", "accepted"),
      doc("identity", "party-leo", "accepted"),
      doc("address_proof", "party-ana", "received"),
      doc("boarding_pass", null, "accepted"),
    ];
    expect(documentsStanding(needs, documents)).toEqual({ state: "checking", owed: 0 });
  });
  it("is complete once the firm accepted one for each need", () => {
    const documents = [
      doc("identity", "party-ana", "accepted"),
      doc("identity", "party-leo", "accepted"),
      doc("address_proof", "party-ana", "accepted"),
      doc("ticket", "party-ana", "accepted"),
    ];
    expect(documentsStanding(needs, documents)).toEqual({ state: "complete", owed: 0 });
  });
  it("is none when the setting asks for no document", () => {
    expect(documentsStanding([], [doc("receipt", "party-ana", "received")])).toEqual({ state: "none", owed: 0 });
  });
});

describe("extraDocuments", () => {
  it("keeps what answers no need, in the order it came", () => {
    const receipt = doc("receipt", "party-ana", "received");
    const evidence = doc("evidence", null, "accepted");
    const documents = [
      doc("identity", "party-ana", "accepted"),
      receipt,
      doc("boarding_pass", null, "received"),
      evidence,
    ];
    expect(extraDocuments(needs, documents)).toEqual([receipt, evidence]);
  });
  it("keeps a proof of address of somebody the need is not of", () => {
    const childProof = doc("address_proof", "party-leo", "received");
    expect(extraDocuments(needs, [childProof])).toEqual([childProof]);
  });
});

describe("latestRefusal", () => {
  it("is the latest the firm refused, or none", () => {
    const first = { ...doc("identity", "party-ana", "rejected", "2026-11-03T10:00:00Z"), id: "a" };
    const second = { ...doc("identity", "party-ana", "rejected", "2026-11-03T11:00:00Z"), id: "b" };
    expect(latestRefusal([second, first])?.id).toBe("b");
    expect(latestRefusal([{ ...doc("identity", "party-ana", "accepted"), id: "c" }])).toBeNull();
  });
});
