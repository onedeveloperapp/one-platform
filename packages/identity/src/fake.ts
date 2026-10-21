import {
  type CpfLookup,
  type CpfLookupResult,
  type CpfRecord,
  normalizeBirthDate,
  normalizeCpf,
} from "@flyee/identity/types";

/**
 * The CPF registry in memory, for development and tests. It answers only for
 * the people a test registers, who must be invented: never put a real
 * person's CPF in a fixture. Like the registry, it answers for the pair of a
 * CPF and its birth date, and never for somebody under 18 on `today`.
 */
export class FakeCpfLookup implements CpfLookup {
  private readonly people = new Map<string, CpfRecord>();
  private readonly today: string;

  /** How many lookups reached the registry: a refused number never counts. */
  lookups = 0;

  constructor(people: CpfRecord[] = [], options: { today?: string } = {}) {
    this.today = options.today ?? new Date().toISOString().slice(0, 10);
    for (const person of people) this.register(person);
  }

  /** Registers an invented person. The CPF must pass its check digits, like any other. */
  register(person: CpfRecord): void {
    const cpf = normalizeCpf(person.cpf);
    this.people.set(cpf, { ...person, cpf });
  }

  async lookupCpf(cpf: string, birthDate: string): Promise<CpfLookupResult> {
    const digits = normalizeCpf(cpf);
    const born = normalizeBirthDate(birthDate);
    this.lookups += 1;
    const found = this.people.get(digits);
    if (!found) return { kind: "not_found" };
    if (found.birthDate && found.birthDate !== born) return { kind: "birth_date_mismatch" };
    const eighteenth = `${Number(born.slice(0, 4)) + 18}${born.slice(4)}`;
    if (eighteenth > this.today) return { kind: "minor" };
    return { kind: "found", record: { ...found }, partial: false };
  }
}
