import "server-only";

import {
  PEOPLE_SHOWN,
  type PeopleNumbers,
  type PeoplePage,
  type PeopleView,
  readPeopleNumbers,
  readPeoplePage,
  readSegments,
  type Segment,
} from "@/lib/people/people";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the screens of the firm's people read (migrations 0133 and 0134), under the person's own session. */

export async function loadPeoplePage(
  supabase: SupabaseClient,
  firmId: string,
  view: PeopleView,
  search: string | null,
  page: number,
): Promise<PeoplePage> {
  const { data, error } = await supabase.rpc("firm_people", {
    target_org: firmId,
    target_view: view,
    target_search: search,
    target_limit: PEOPLE_SHOWN,
    target_offset: page * PEOPLE_SHOWN,
  });
  if (error) throw new Error("firm_people failed");
  return readPeoplePage(data);
}

export async function loadPeopleNumbers(supabase: SupabaseClient, firmId: string): Promise<PeopleNumbers> {
  const { data, error } = await supabase.rpc("firm_people_numbers", { target_org: firmId });
  if (error) throw new Error("firm_people_numbers failed");
  return readPeopleNumbers(data);
}

export async function loadSegments(supabase: SupabaseClient, firmId: string): Promise<Segment[]> {
  const { data, error } = await supabase.rpc("firm_segments", { target_org: firmId });
  if (error) throw new Error("firm_segments failed");
  return readSegments(data);
}

export type MarketingTerm = {
  version: string;
  text: string;
  accepted: boolean;
  acceptedAt: string | null;
  /** The person decides for the firm, and may accept it. */
  decides: boolean;
  /** The person makes, changes, archives and exports segments. */
  manages: boolean;
};

export async function loadMarketingTerm(supabase: SupabaseClient, firmId: string): Promise<MarketingTerm | null> {
  const { data, error } = await supabase.rpc("firm_marketing_term", { target_org: firmId });
  if (error || !data) return null;
  const term = data as Record<string, unknown>;
  if (typeof term.version !== "string" || typeof term.text !== "string") return null;
  return {
    version: term.version,
    text: term.text,
    accepted: term.accepted === true,
    acceptedAt: typeof term.accepted_at === "string" ? term.accepted_at : null,
    decides: term.decides === true,
    manages: term.manages === true,
  };
}

export type PersonCase = {
  id: string;
  seq: number;
  status: string;
  incident: string | null;
  origin: string | null;
  airline: string | null;
  createdAt: string;
  isTest: boolean;
  roles: string[];
};

export type PersonPage = {
  person: Record<string, unknown>;
  minor: boolean;
  active: boolean;
  cases: PersonCase[];
  lawsuits: { id: string; caseId: string; caseSeq: number; cnj: string | null; court: string; status: string }[];
  documents: { id: string; caseId: string; caseSeq: number; kind: string; status: string; createdAt: string }[];
  conversations: {
    id: string;
    name: string | null;
    number: string;
    lastMessageAt: string | null;
    preview: string | null;
  }[];
  notices: { kind: string; caseId: string; at: string }[];
  requests: { id: string; kind: string; how: string; status: string; refusal: string | null; requestedAt: string }[];
  may: { data: boolean; marketing: boolean };
};

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    : [];
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const opt = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A person's page, or null when the firm has no such person. */
export async function loadPerson(
  supabase: SupabaseClient,
  firmId: string,
  personId: string,
): Promise<PersonPage | null> {
  const { data, error } = await supabase.rpc("firm_person", { target_org: firmId, target_person: personId });
  if (error) throw new Error("firm_person failed");
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) return null;
  const may = (answer.may ?? {}) as Record<string, unknown>;
  return {
    person: (answer.person ?? {}) as Record<string, unknown>,
    minor: answer.minor === true,
    active: answer.active === true,
    cases: list(answer.cases).map((row) => ({
      id: str(row.id),
      seq: num(row.seq),
      status: str(row.status),
      incident: opt(row.incident),
      origin: opt(row.origin),
      airline: opt(row.airline),
      createdAt: str(row.created_at),
      isTest: row.is_test === true,
      roles: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === "string") : [],
    })),
    lawsuits: list(answer.lawsuits).map((row) => ({
      id: str(row.id),
      caseId: str(row.case_id),
      caseSeq: num(row.case_seq),
      cnj: opt(row.cnj),
      court: str(row.court),
      status: str(row.status),
    })),
    documents: list(answer.documents).map((row) => ({
      id: str(row.id),
      caseId: str(row.case_id),
      caseSeq: num(row.case_seq),
      kind: str(row.kind),
      status: str(row.status),
      createdAt: str(row.created_at),
    })),
    conversations: list(answer.conversations).map((row) => ({
      id: str(row.id),
      name: opt(row.name),
      number: str(row.number),
      lastMessageAt: opt(row.last_message_at),
      preview: opt(row.preview),
    })),
    notices: list(answer.notices).map((row) => ({ kind: str(row.kind), caseId: str(row.case_id), at: str(row.at) })),
    requests: list(answer.requests).map((row) => ({
      id: str(row.id),
      kind: str(row.kind),
      how: str(row.how),
      status: str(row.status),
      refusal: opt(row.refusal),
      requestedAt: str(row.requested_at),
    })),
    may: { data: may.data === true, marketing: may.marketing === true },
  };
}
