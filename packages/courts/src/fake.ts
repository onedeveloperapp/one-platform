import { hostOfLink, isEmptyText, kindOfCommunication, systemOfHost } from "@flyee/courts/djen-systems";
import { oabNumberKey, oabStateKey } from "@flyee/courts/oab";
import { DjenInvalidQueryError } from "@flyee/courts/providers/djen";
import type {
  CourtMovement,
  CourtProceeding,
  DjenClient,
  DjenCommunication,
  DjenProbe,
  FilingChannel,
  FilingOutcome,
  LawsuitFiling,
  OabRegistration,
  PetitionFiling,
  ProceedingRead,
  ProceedingSource,
} from "@flyee/courts/types";

/**
 * A communication as a test publishes it: with the lawyers it is addressed
 * to. What the court does not always give (its unit, the class of the case)
 * may be left out, and a communication is active unless the test says the
 * court cancelled it.
 */
type Optional = "unit" | "className" | "active" | "documentType" | "cancelReason";
export type FakeDjenEntry = Omit<DjenCommunication, Optional> &
  Partial<Pick<DjenCommunication, Optional>> & { lawyers: OabRegistration[] };

type Stored = { communication: DjenCommunication; lawyers: OabRegistration[] };

/** The same registration: the same state and the same number, letter included ("12345" is not "12345A"). */
const sameLawyer = (a: OabRegistration, b: OabRegistration) =>
  oabStateKey(a.uf) === oabStateKey(b.uf) && oabNumberKey(a.number) === oabNumberKey(b.number);

/**
 * The DJEN in memory, for development and tests: a test publishes what a
 * court would publish and the capture reads it back through the same
 * interface as the real client. Deterministic: no clock, no network.
 */
export class FakeDjenClient implements DjenClient {
  private readonly stored = new Map<string, Stored>();

  /** How many times it was asked, so a test of the capture can prove it paces and does not repeat. */
  readonly calls = { listByOab: 0, listByProcess: 0, probe: 0 };

  /** What the next looks of the watch meet instead of an answer (an outage), while it is set. */
  probeError: Error | null = null;

  constructor(entries: FakeDjenEntry[] = []) {
    for (const entry of entries) this.publish(entry);
  }

  /** Publishes a communication, as the court would. A hash published twice is the same communication. */
  publish(entry: FakeDjenEntry): void {
    const { lawyers, ...published } = entry;
    const communication: DjenCommunication = {
      unit: null,
      className: null,
      documentType: null,
      active: true,
      cancelReason: null,
      ...published,
    };
    this.stored.set(entry.hash, { communication, lawyers: lawyers.map((lawyer) => ({ ...lawyer })) });
  }

  async listByOab(input: OabRegistration & { since: string; until?: string }): Promise<DjenCommunication[]> {
    this.calls.listByOab += 1;
    return [...this.stored.values()]
      .filter(
        ({ communication, lawyers }) =>
          communication.availableOn >= input.since &&
          (!input.until || communication.availableOn <= input.until) &&
          lawyers.some((lawyer) => sameLawyer(lawyer, input)),
      )
      .map(({ communication }) => ({ ...communication }))
      .sort((a, b) => a.availableOn.localeCompare(b.availableOn) || a.hash.localeCompare(b.hash));
  }

  async listByProcess(input: { cnj: string }): Promise<DjenCommunication[]> {
    this.calls.listByProcess += 1;
    const cnj = input.cnj.replace(/\D/g, "");
    if (!/^\d{20}$/.test(cnj)) throw new DjenInvalidQueryError("number");
    return [...this.stored.values()]
      .filter(({ communication }) => communication.cnj === cnj)
      .map(({ communication }) => ({ ...communication }))
      .sort((a, b) => a.availableOn.localeCompare(b.availableOn) || a.hash.localeCompare(b.hash));
  }

  certificateUrl(hash: string): string {
    return `https://djen.invalid/api/v1/comunicacao/${encodeURIComponent(hash)}/certidao`;
  }

  async probe(input: { court: string; day: string }): Promise<DjenProbe> {
    this.calls.probe += 1;
    if (this.probeError) throw this.probeError;
    const court = input.court.trim().toUpperCase();
    const found = [...this.stored.values()]
      .map(({ communication }) => communication)
      .filter((communication) => communication.court === court && communication.availableOn === input.day)
      .slice(0, 100);
    const probe: DjenProbe = { items: found.length, withoutText: 0, systems: {} };
    for (const communication of found) {
      if (isEmptyText(communication.text)) probe.withoutText += 1;
      const kind = kindOfCommunication({ className: communication.className, unit: communication.unit });
      const system = systemOfHost(hostOfLink(communication.link));
      if (!kind || !system) continue;
      const bucket = (probe.systems[kind] ??= {});
      bucket[system] = (bucket[system] ?? 0) + 1;
    }
    return probe;
  }
}

/** A lawsuit as a test declares it: what is not said is empty. */
export type FakeProceeding = Partial<CourtProceeding> & { number: string; movements?: CourtMovement[] };

/**
 * A source of the course of lawsuits in memory, for development and tests: a
 * test declares the lawsuits a court shows, and which courts the source
 * covers, and the tracking reads them back through the same interface as the
 * real sources. A lawsuit declared as unreachable makes the source fail for
 * it, as a court out of the air does.
 */
export class FakeProceedingSource implements ProceedingSource {
  readonly name: string;
  private readonly courts: readonly string[];
  private readonly lawsuits = new Map<string, FakeProceeding | "unreachable">();

  /** `courts`: the J.TR of the numbers it covers ("809" for TJGO); none covers every court. */
  constructor(name = "fake", courts: readonly string[] = []) {
    this.name = name;
    this.courts = courts;
  }

  add(lawsuit: FakeProceeding): void {
    this.lawsuits.set(lawsuit.number.replace(/\D/g, ""), lawsuit);
  }

  /** A lawsuit the source fails for. */
  unreachable(cnj: string): void {
    this.lawsuits.set(cnj.replace(/\D/g, ""), "unreachable");
  }

  covers(cnj: string): boolean {
    return /^\d{20}$/.test(cnj) && (this.courts.length === 0 || this.courts.includes(cnj.slice(13, 16)));
  }

  async read(cnj: string): Promise<ProceedingRead> {
    const lawsuit = this.lawsuits.get(cnj);
    if (lawsuit === "unreachable") throw new Error(`${this.name}_unavailable`);
    if (!lawsuit || !this.covers(cnj)) return { found: false };
    const { movements = [], ...declared } = lawsuit;
    const proceeding: CourtProceeding = {
      unit: null,
      className: null,
      subjects: [],
      phase: null,
      status: null,
      claimValue: null,
      distributedOn: null,
      finalOn: null,
      secret: false,
      lawyers: [],
      responsibles: [],
      pending: [],
      ...declared,
    };
    return {
      found: true,
      proceeding,
      movements: proceeding.secret ? [] : [...movements].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
}

/** The national codes of an initial petition taken first (Resolução CNJ 46): 202 and its children 361, 362, 363. */
const INITIAL_PETITION_TYPES = ["202", "361", "362", "363"];

/** The bytes of a PDF: its header within the first 1,024 bytes. */
const isPdf = (bytes: Uint8Array): boolean =>
  bytes instanceof Uint8Array && new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");

/**
 * The two check digits of a CNJ number from its other 18, in the order Annex VIII of Resolução CNJ 65/2008 puts
 * them (NNNNNNN AAAA J TR OOOO): 98 minus that number followed by 00, modulo 97. As `@flyee/rules/cnj` computes them.
 */
const cnjCheckDigits = (withoutCheck: string): string =>
  String(98n - (BigInt(`${withoutCheck}00`) % 97n)).padStart(2, "0");

/** The moment the fake court says it received a lawsuit, unless the test gives it a clock. */
export const FAKE_FILING_CLOCK = "2026-10-15T13:00:00.000Z";

/**
 * A court's filing channel in memory, for development and tests. It takes what the MNI takes at the least (a
 * plaintiff, a defendant, the initial petition first, every document a PDF) and refuses anything else, saying why;
 * a lawsuit it takes gets the protocol `FAKE-<n>`, a number of TJGO of the year 2099 (segment 8, court 09, origin
 * 0001, sequence n) with its check digits, a small receipt and the moment of its clock. Deterministic: no network,
 * and a fixed clock unless the test gives one.
 *
 * It keeps every filing that reached it (`received`): taken, refused, or whose answer was lost. A test makes the
 * next sending fail (`failNext`): `unavailable` reaches nothing (nothing is received); `unknown` reaches the fake
 * court and answers nothing (it is received, and nothing of it is told).
 */
export class FakeFilingChannel implements FilingChannel {
  readonly name = "fake";
  readonly received: LawsuitFiling[] = [];
  private readonly clock: () => Date;
  private filed = 0;
  private next: "unavailable" | "unknown" | null = null;

  constructor(options: { now?: () => Date } = {}) {
    this.clock = options.now ?? (() => new Date(FAKE_FILING_CLOCK));
  }

  /** The next sending fails so: `unavailable` (the court could not be reached) or `unknown` (no answer came). */
  failNext(kind: "unavailable" | "unknown"): void {
    this.next = kind;
  }

  async fileLawsuit(filing: LawsuitFiling): Promise<FilingOutcome> {
    const failing = this.next;
    this.next = null;
    if (failing === "unavailable") return { kind: "unavailable", reason: "fake_unreachable" };
    this.received.push(filing);
    if (failing === "unknown") return { kind: "unknown", reason: "fake_no_answer" };

    const problems: string[] = [];
    if (filing.plaintiffs.length === 0) problems.push("a ação não tem autor");
    if (filing.defendants.length === 0) problems.push("a ação não tem réu");
    if (filing.documents.length === 0) problems.push("a ação não tem documento");
    else if (!INITIAL_PETITION_TYPES.includes(filing.documents[0].typeCode)) {
      problems.push("o primeiro documento não é a petição inicial");
    }
    filing.documents.forEach((document, index) => {
      if (!isPdf(document.pdf)) problems.push(`o documento ${index + 1} não é um PDF`);
    });
    if (problems.length > 0) {
      return { kind: "refused", protocol: null, message: `O tribunal simulado não recebeu: ${problems.join("; ")}.` };
    }

    this.filed += 1;
    const sequence = String(this.filed).padStart(7, "0");
    const rest = { year: "2099", segment: "8", court: "09", origin: "0001" };
    const check = cnjCheckDigits(`${sequence}${rest.year}${rest.segment}${rest.court}${rest.origin}`);
    const protocol = `FAKE-${this.filed}`;
    return {
      kind: "filed",
      protocol,
      caseNumber: `${sequence}${check}${rest.year}${rest.segment}${rest.court}${rest.origin}`,
      receipt: new TextEncoder().encode(`%PDF-1.4\n% Recibo do tribunal simulado, protocolo ${protocol}\n%%EOF\n`),
      at: this.clock(),
      message: "Petição recebida pelo tribunal simulado.",
    };
  }

  /** Petitions into a lawsuit that reached it: taken, refused, or whose answer was lost. */
  readonly petitions: PetitionFiling[] = [];

  async filePetition(filing: PetitionFiling): Promise<FilingOutcome> {
    const failing = this.next;
    this.next = null;
    if (failing === "unavailable") return { kind: "unavailable", reason: "fake_unreachable" };
    this.petitions.push(filing);
    if (failing === "unknown") return { kind: "unknown", reason: "fake_no_answer" };
    const problems: string[] = [];
    if (!/^\d{20}$/.test(filing.caseNumber)) problems.push("o número do processo não é um número CNJ");
    if (filing.documents.length === 0) problems.push("a petição não tem documento");
    filing.documents.forEach((document, index) => {
      if (!isPdf(document.pdf)) problems.push(`o documento ${index + 1} não é um PDF`);
    });
    if (problems.length > 0) {
      return { kind: "refused", protocol: null, message: `O tribunal simulado não recebeu: ${problems.join("; ")}.` };
    }
    const protocol = `FAKE-P-${this.petitions.length}`;
    return {
      kind: "filed",
      protocol,
      caseNumber: filing.caseNumber,
      receipt: new TextEncoder().encode(`%PDF-1.4\n% Recibo do tribunal simulado, protocolo ${protocol}\n%%EOF\n`),
      at: this.clock(),
      message: "Petição juntada pelo tribunal simulado.",
    };
  }
}
