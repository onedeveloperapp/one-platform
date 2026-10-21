import { oabNumberKey, oabStateKey } from "@flyee/courts/oab";
import type {
  CourtMovement,
  CourtProceeding,
  DjenClient,
  DjenCommunication,
  OabRegistration,
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
  readonly calls = { listByOab: 0 };

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

  certificateUrl(hash: string): string {
    return `https://djen.invalid/api/v1/comunicacao/${encodeURIComponent(hash)}/certidao`;
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
