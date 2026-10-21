import type { Envelope, ReadAnswer, SealedPlace, StoreAnswer, VaultStore } from "@flyee/connectors/types";

type FakeConnection = {
  id: string;
  orgId: string;
  provider: string;
  externalId: string | null;
  status: "pending" | "connected" | "error" | "expired" | "disconnected";
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  lastError: string | null;
  envelope: Envelope | null;
};

/**
 * The vault's store in memory, with the rules of the real one (migration
 * 0017) that the vault depends on: a token is sealed under a connection a
 * person started, a cut or expired connection gives nothing to read and is
 * not sealed again by the backend, a token past its validity is discarded
 * when asked for, every read is recorded with its purpose, and a reseal
 * happens only if the token is still the one read.
 */
export class FakeVaultStore implements VaultStore {
  readonly connections = new Map<string, FakeConnection>();
  /** Every read, in order: what the audit trail records. */
  readonly reads: { connectionId: string; purpose: string }[] = [];
  private sequence = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** What `begin_connection` does for a person who manages the firm. */
  begin(orgId: string, provider: string, externalId: string | null = null): string {
    for (const connection of this.connections.values()) {
      if (connection.orgId === orgId && connection.provider === provider && connection.externalId === externalId) {
        if (connection.status !== "connected" && connection.status !== "error") connection.status = "pending";
        return connection.id;
      }
    }
    this.sequence += 1;
    const id = `connection-${this.sequence}`;
    this.connections.set(id, {
      id,
      orgId,
      provider,
      externalId,
      status: "pending",
      expiresAt: null,
      metadata: {},
      lastError: null,
      envelope: null,
    });
    return id;
  }

  /** What `disconnect_connection` does: the token is discarded at once. */
  disconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    connection.status = "disconnected";
    connection.envelope = null;
  }

  /** The connection, when it exists AND belongs to the firm: one of another firm is not found. */
  private of(place: SealedPlace): FakeConnection | null {
    const connection = this.connections.get(place.connectionId);
    return connection && connection.orgId === place.orgId ? connection : null;
  }

  async store(input: {
    place: SealedPlace;
    envelope: Envelope;
    expiresAt?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<StoreAnswer> {
    const connection = this.of(input.place);
    if (!connection) return { ok: false, code: "not_found" };
    if (connection.status === "disconnected" || connection.status === "expired") {
      return { ok: false, code: connection.status };
    }
    if (input.expiresAt && Date.parse(input.expiresAt) <= this.now()) return { ok: false, code: "already_expired" };
    const replaced = connection.envelope !== null;
    connection.envelope = { ...input.envelope };
    connection.status = "connected";
    connection.expiresAt = input.expiresAt ?? null;
    connection.lastError = null;
    if (input.metadata) connection.metadata = { ...input.metadata };
    return { ok: true, code: replaced ? "replaced" : "stored" };
  }

  async read(place: SealedPlace, purpose: string): Promise<ReadAnswer> {
    const connection = this.of(place);
    if (!connection) return { ok: false, code: "not_found" };
    const usable = connection.status === "connected" || connection.status === "error";
    if (usable && connection.expiresAt && Date.parse(connection.expiresAt) <= this.now()) {
      connection.status = "expired";
      connection.envelope = null;
      return { ok: false, code: "expired" };
    }
    if (connection.status !== "connected" && connection.status !== "error") return { ok: false, code: connection.status };
    if (!connection.envelope) return { ok: false, code: "no_secret" };
    this.reads.push({ connectionId: place.connectionId, purpose });
    return {
      ok: true,
      orgId: connection.orgId,
      provider: connection.provider,
      externalId: connection.externalId,
      status: connection.status,
      expiresAt: connection.expiresAt,
      envelope: { ...connection.envelope },
    };
  }

  async reportStatus(place: SealedPlace, ok: boolean, errorCode: string | null = null): Promise<void> {
    const connection = this.of(place);
    if (!connection || (connection.status !== "connected" && connection.status !== "error")) return;
    connection.status = ok ? "connected" : "error";
    connection.lastError = ok ? null : errorCode;
  }

  async rewrapPending(keyVersion: number, limit: number): Promise<SealedPlace[]> {
    return [...this.connections.values()]
      .filter((connection) => connection.envelope !== null && connection.envelope.keyVersion < keyVersion)
      .slice(0, limit)
      .map((connection) => ({ orgId: connection.orgId, connectionId: connection.id }));
  }

  async rewrap(input: { place: SealedPlace; fromVersion: number; envelope: Envelope }): Promise<boolean> {
    const connection = this.of(input.place);
    if (!connection?.envelope || connection.envelope.keyVersion !== input.fromVersion) return false;
    connection.envelope = { ...input.envelope };
    return true;
  }
}
