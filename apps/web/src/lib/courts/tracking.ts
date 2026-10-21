import "server-only";

import { EscavadorSource } from "@flyee/courts/providers/escavador";
import { JuditSource } from "@flyee/courts/providers/judit";
import { ProjudiTjgoSource } from "@flyee/courts/providers/projudi";
import type { ProceedingSource } from "@flyee/courts/types";

/**
 * Where the course of the firms' lawsuits is read (migration 0031): TJGO's
 * Projudi, by its public webservice, and an aggregator of many courts for
 * every other one. The courts are read with no key, so whether an
 * environment reads them is a switch, as for the DJEN:
 *
 *   production          reads them, unless `COURT_TRACKING=0`;
 *   anywhere else       reads them only with `COURT_TRACKING=1`.
 *
 * A development machine or a preview holds invented lawsuits, and an
 * invented number may be somebody's real lawsuit. The aggregator is the one
 * `COURT_AGGREGATOR` names (`escavador` or `judit`), with its key
 * (`ESCAVADOR_API_TOKEN`, `JUDIT_API_KEY`); with none, the lawsuits of other
 * courts wait, and their screen says why.
 */
export function isCourtTrackingOn(): boolean {
  const flag = (process.env.COURT_TRACKING ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.VERCEL_ENV === "production";
}

let projudi: ProceedingSource | null = null;

export function projudiSource(): ProceedingSource | null {
  if (!isCourtTrackingOn()) return null;
  projudi ??= new ProjudiTjgoSource();
  return projudi;
}

/** The aggregator configured, or null. */
export function aggregatorSource(): ProceedingSource | null {
  if (!isCourtTrackingOn()) return null;
  const chosen = (process.env.COURT_AGGREGATOR ?? "").trim().toLowerCase();
  if (chosen === "escavador") {
    const token = (process.env.ESCAVADOR_API_TOKEN ?? "").trim();
    return token ? new EscavadorSource({ token }) : null;
  }
  if (chosen === "judit") {
    const apiKey = (process.env.JUDIT_API_KEY ?? "").trim();
    return apiKey ? new JuditSource({ apiKey }) : null;
  }
  return null;
}

export type TrackingSources = { projudi: ProceedingSource | null; aggregator: ProceedingSource | null };

export const trackingSources = (): TrackingSources => ({ projudi: projudiSource(), aggregator: aggregatorSource() });
