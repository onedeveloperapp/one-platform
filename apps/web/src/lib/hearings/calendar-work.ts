import "server-only";

import { calendarGrant, calendarProvider, type GrantAccess } from "@/lib/calendar/provider";
import { getVault } from "@/lib/connections/vault";
import { eventOf, type HearingToSync } from "@/lib/hearings/hearings";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { eventIdOf } from "@flyee/calendar/event-id";
import {
  CalendarAuthError,
  CalendarGoneError,
  CalendarPlatformError,
  type CalendarProvider,
  CalendarRequestError,
  CalendarUnavailableError,
} from "@flyee/calendar/types";
import { BRAND } from "@flyee/content";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the firm's calendar (migration 0037): claim the
 * hearings whose event is not of their revision in force in the firm's
 * calendar, read what each is written from (`hearing_to_sync`), open the
 * firm's grant in the vault (once per connection and round), write the event
 * (or take out the one of a cancelled hearing) and record it for the revision
 * read; then take out the events of hearings that went with their lawsuit or
 * case (`claim_hearing_removals`). A grant that no longer holds, or a
 * calendar deleted in Google, is the calendar's problem and never a
 * hearing's: the calendar is said to the firm as lost (unless the account
 * was connected again after the grant was opened), and the hearing's try is
 * given back. What is the platform's own (its project out of its day, its
 * client refused, the API off) stops the round for every firm, with every
 * try given back and nothing of any firm stopped.
 */

export type SyncReport = {
  claimed: number;
  synced: number;
  retried: number;
  failed: number;
  released: number;
  lost: number;
  removed: number;
  /** The platform's side refused the work: the round stopped, and the next one waits. */
  stopped: boolean;
};

type Claim = { hearing_id: string; claim: number };
type RemovalClaim = { hearing_id: string; claim: number; org_id: string; calendar_id: string; connection_id: string };

/** A grant opened for a round, with when: a connection sealed again after it was opened speaks for itself. */
type Opened = { access: GrantAccess; at: string };

/** What a round shares: the grants opened, one per connection, and whether the platform's side stopped it. */
type Round = { grants: Map<string, Opened>; stopped: boolean };

async function grantOf(round: Round, place: { orgId: string; connectionId: string }): Promise<Opened> {
  const known = round.grants.get(place.connectionId);
  if (known) return known;
  const at = new Date().toISOString();
  const opened = { access: await calendarGrant(place, "calendar.sync"), at };
  round.grants.set(place.connectionId, opened);
  return opened;
}

async function record(
  service: SupabaseClient,
  read: { id: string; claim: number; revision: number; calendar: string | null },
  outcome: "synced" | "retry" | "failed" | "release",
  code: string | null,
): Promise<string> {
  const { data, error } = await service.rpc("record_hearing_sync", {
    target_hearing: read.id,
    target_claim: read.claim,
    target_revision: read.revision,
    target_calendar: read.calendar,
    target_outcome: outcome,
    target_code: code,
  });
  if (error) throw new Error(`record_hearing_sync failed: ${error.code ?? "unknown"}`);
  return String((data as { code?: string } | null)?.code ?? "");
}

/**
 * The calendar stopped: said to the firm (and, for a grant refused, to the
 * connection), once per round, and only when the account was not connected
 * again after this round opened the grant.
 */
async function calendarLost(
  service: SupabaseClient,
  round: Round,
  place: { orgId: string; connectionId: string },
  calendarId: string,
  thrown: CalendarAuthError | CalendarGoneError,
  openedAt: string,
): Promise<void> {
  const problem = thrown instanceof CalendarGoneError ? "gone" : "auth";
  const { data } = await service.rpc("firm_calendar_lost", {
    target_org: place.orgId,
    target_calendar: calendarId,
    target_problem: problem,
    target_since: openedAt,
  });
  if (problem !== "auth") return;
  round.grants.set(place.connectionId, { access: { ok: false, code: "grant_refused" }, at: openedAt });
  if ((data as { code?: string } | null)?.code !== "lost") return;
  const access = getVault();
  if (access.ok) await access.vault.report(place, false, "grant_refused").catch(() => undefined);
}

/** Writes one claimed hearing's event, and says how it went. */
async function syncOne(
  service: SupabaseClient,
  provider: CalendarProvider,
  claim: Claim,
  round: Round,
  report: SyncReport,
): Promise<void> {
  const { data, error } = await service.rpc("hearing_to_sync", {
    target_hearing: claim.hearing_id,
    target_claim: claim.claim,
  });
  if (error) throw new Error(`hearing_to_sync failed: ${error.code ?? "unknown"}`);
  // Nothing to read: the claim is no longer this worker's, or the calendar stopped meanwhile.
  if (!data) {
    await record(
      service,
      { id: claim.hearing_id, claim: claim.claim, revision: 0, calendar: null },
      "release",
      "no_calendar",
    )
      .then(() => (report.released += 1))
      .catch(() => undefined);
    return;
  }
  const read = data as HearingToSync;
  const target = { id: read.id, claim: claim.claim, revision: read.revision, calendar: read.calendar_id };
  if (round.stopped) {
    await record(service, target, "release", "platform");
    report.released += 1;
    return;
  }
  const place = { orgId: read.org_id, connectionId: read.connection_id };
  const opened = await grantOf(round, place);
  if (!opened.access.ok) {
    await record(service, target, "release", opened.access.code);
    report.released += 1;
    return;
  }
  try {
    if (read.status === "cancelled") {
      await provider.deleteEvent(opened.access.grant, read.calendar_id, eventIdOf(read.id));
    } else {
      await provider.upsertEvent(opened.access.grant, read.calendar_id, eventOf(read, BRAND.siteUrl));
    }
  } catch (thrown) {
    if (thrown instanceof CalendarAuthError || thrown instanceof CalendarGoneError) {
      await calendarLost(service, round, place, read.calendar_id, thrown, opened.at);
      await record(service, target, "release", thrown instanceof CalendarGoneError ? "gone" : "auth");
      report.lost += 1;
      return;
    }
    if (thrown instanceof CalendarPlatformError) {
      round.stopped = true;
      report.stopped = true;
      await record(service, target, "release", "platform");
      report.released += 1;
      return;
    }
    if (thrown instanceof CalendarUnavailableError) {
      await record(service, target, "retry", thrown.code);
      report.retried += 1;
      return;
    }
    if (thrown instanceof CalendarRequestError) {
      await record(service, target, "failed", thrown.code);
      report.failed += 1;
      return;
    }
    throw thrown;
  }
  const answer = await record(service, target, "synced", null);
  if (answer === "synced") report.synced += 1;
  else report.released += 1;
}

async function recordRemoval(
  service: SupabaseClient,
  claim: RemovalClaim,
  outcome: "done" | "retry" | "failed" | "release",
  code: string | null,
): Promise<void> {
  const { error } = await service.rpc("record_hearing_removal", {
    target_hearing: claim.hearing_id,
    target_claim: claim.claim,
    target_outcome: outcome,
    target_code: code,
  });
  if (error) throw new Error(`record_hearing_removal failed: ${error.code ?? "unknown"}`);
}

/** Takes out the event of one hearing that went. */
async function removeOne(
  service: SupabaseClient,
  provider: CalendarProvider,
  claim: RemovalClaim,
  round: Round,
  report: SyncReport,
): Promise<void> {
  if (round.stopped) return recordRemoval(service, claim, "release", "platform");
  const place = { orgId: claim.org_id, connectionId: claim.connection_id };
  const opened = await grantOf(round, place);
  if (!opened.access.ok) return recordRemoval(service, claim, "release", opened.access.code);
  try {
    await provider.deleteEvent(opened.access.grant, claim.calendar_id, eventIdOf(claim.hearing_id));
  } catch (thrown) {
    if (thrown instanceof CalendarAuthError || thrown instanceof CalendarGoneError) {
      await calendarLost(service, round, place, claim.calendar_id, thrown, opened.at);
      return recordRemoval(service, claim, "release", thrown instanceof CalendarGoneError ? "gone" : "auth");
    }
    if (thrown instanceof CalendarPlatformError) {
      round.stopped = true;
      report.stopped = true;
      return recordRemoval(service, claim, "release", "platform");
    }
    if (thrown instanceof CalendarUnavailableError) return recordRemoval(service, claim, "retry", thrown.code);
    if (thrown instanceof CalendarRequestError) return recordRemoval(service, claim, "failed", thrown.code);
    throw thrown;
  }
  await recordRemoval(service, claim, "done", null);
  report.removed += 1;
}

/**
 * Claims what is owed (or the one hearing named) and writes it, then takes
 * out what is owed of hearings that went. Nothing is claimed where no
 * calendar provider is configured: the hearings wait for an environment that
 * has one.
 */
export async function syncHearings(
  service: SupabaseClient,
  options: { limit?: number; hearingId?: string | null } = {},
  provider: CalendarProvider | null = calendarProvider(),
): Promise<SyncReport> {
  const report: SyncReport = {
    claimed: 0,
    synced: 0,
    retried: 0,
    failed: 0,
    released: 0,
    lost: 0,
    removed: 0,
    stopped: false,
  };
  if (!provider) return report;
  const round: Round = { grants: new Map(), stopped: false };
  const { data: claims, error } = await service.rpc("claim_hearing_syncs", {
    target_limit: options.limit ?? 20,
    target_hearing: options.hearingId ?? null,
  });
  if (error) throw new Error(`claim_hearing_syncs failed: ${error.code ?? "unknown"}`);
  for (const claim of (claims ?? []) as Claim[]) {
    report.claimed += 1;
    try {
      await syncOne(service, provider, claim, round, report);
    } catch {
      // What failed is the platform's (a read, a write): the claim goes back with a word.
      await service
        .rpc("record_hearing_sync", {
          target_hearing: claim.hearing_id,
          target_claim: claim.claim,
          target_revision: 0,
          target_calendar: null,
          target_outcome: "release",
          target_code: "unfinished",
        })
        .then(
          () => undefined,
          () => undefined,
        );
      report.released += 1;
    }
  }
  // A person's own hearing is written and answered at once; what went is the sweep's.
  if (options.hearingId || round.stopped) return report;
  const { data: removals, error: removalError } = await service.rpc("claim_hearing_removals", {
    target_limit: options.limit ?? 20,
  });
  if (removalError) throw new Error(`claim_hearing_removals failed: ${removalError.code ?? "unknown"}`);
  for (const claim of (removals ?? []) as RemovalClaim[]) {
    try {
      await removeOne(service, provider, claim, round, report);
    } catch {
      await recordRemoval(service, claim, "release", "unfinished").catch(() => undefined);
    }
  }
  return report;
}

/**
 * What the firm's calendar is owed now (one hearing, or everything after a
 * calendar was connected or made) is written right after the response is
 * sent. Never a wait in a person's answer; the sweep writes what is left.
 */
async function settle(hearingId: string | null): Promise<void> {
  soon("hearing-calendar", () =>
    syncHearings(createServiceClient(), hearingId ? { limit: 1, hearingId } : { limit: 50 }),
  );
}

/** A person just wrote a hearing: its event is asked for at once, for a firm whose calendar is in use. */
export async function settleHearingSync(hearingId: string, calendarActive: boolean): Promise<void> {
  if (!calendarActive || !calendarProvider()) return;
  await settle(hearingId);
}

/** A calendar was connected, taken back or made: every hearing it is owed, at once. */
export async function settleCalendarSync(): Promise<void> {
  if (!calendarProvider()) return;
  await settle(null);
}
