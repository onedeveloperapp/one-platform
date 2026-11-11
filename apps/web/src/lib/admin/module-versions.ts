/**
 * The versions of each module (migration 0212), for the operator: what each holds, how many cases it carries, and
 * what changed between the latest published and what is in force now, which the next version would publish. Pure:
 * the database answers (`admin_module_versions`); this file reads it and compares two manifests.
 */

export type ModuleManifest = {
  documents: Record<string, unknown>;
  prompts: Record<string, number>;
  templates: Record<string, { name: string; body: string; proceedingKind: string | null }>;
  kinds: Record<string, { name: string; model: string }>;
};

export type ModuleVersionStatus = "draft" | "published" | "withdrawn";

export type ModuleVersionRow = {
  id: string;
  version: number;
  status: ModuleVersionStatus;
  note: string;
  manifest: ModuleManifest;
  withdrawReason: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  cases: number;
  openCases: number;
};

export type ModuleVersions = {
  key: string;
  name: string;
  tasks: string[];
  now: ModuleManifest;
  versions: ModuleVersionRow[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function readManifest(raw: unknown): ModuleManifest {
  const manifest = record(raw);
  const pieces = record(manifest.pieces);
  return {
    documents: record(manifest.documents),
    prompts: Object.fromEntries(
      Object.entries(record(manifest.prompts)).flatMap(([task, version]) =>
        typeof version === "number" && Number.isInteger(version) ? [[task, version]] : [],
      ),
    ),
    templates: Object.fromEntries(
      Object.entries(record(pieces.templates)).map(([id, value]) => {
        const template = record(value);
        return [
          id,
          {
            name: text(template.name) ?? "",
            body: typeof template.body === "string" ? template.body : "",
            proceedingKind: text(template.proceeding_kind),
          },
        ];
      }),
    ),
    kinds: Object.fromEntries(
      Object.entries(record(pieces.kinds)).map(([slug, value]) => {
        const kind = record(value);
        return [slug, { name: text(kind.name) ?? slug, model: typeof kind.model === "string" ? kind.model : "" }];
      }),
    ),
  };
}

const STATUSES: readonly ModuleVersionStatus[] = ["draft", "published", "withdrawn"];

/** The database's answer, or null when it could not be read as one. */
export function readModuleVersions(raw: unknown): ModuleVersions[] | null {
  const answer = record(raw);
  if (answer.ok !== true || !Array.isArray(answer.modules)) return null;
  return answer.modules.flatMap((item): ModuleVersions[] => {
    const module = record(item);
    const key = text(module.key);
    if (!key) return [];
    return [
      {
        key,
        name: text(module.name) ?? key,
        tasks: Array.isArray(module.tasks)
          ? module.tasks.filter((task): task is string => typeof task === "string")
          : [],
        now: readManifest(module.now),
        versions: (Array.isArray(module.versions) ? module.versions : []).flatMap((value): ModuleVersionRow[] => {
          const version = record(value);
          const id = text(version.id);
          const status = STATUSES.find((item) => item === version.status);
          if (!id || !status || typeof version.version !== "number") return [];
          return [
            {
              id,
              version: version.version,
              status,
              note: text(version.note) ?? "",
              manifest: readManifest(version.manifest),
              withdrawReason: text(version.withdraw_reason),
              createdAt: text(version.created_at),
              publishedAt: text(version.published_at),
              withdrawnAt: text(version.withdrawn_at),
              cases: count(version.cases),
              openCases: count(version.open_cases),
            },
          ];
        }),
      },
    ];
  });
}

/** The latest published version of a module, the one every new case is opened under. */
export const latestPublished = (module: ModuleVersions): ModuleVersionRow | null =>
  module.versions
    .filter((version) => version.status === "published")
    .reduce<ModuleVersionRow | null>(
      (best, version) => (best && best.version > version.version ? best : version),
      null,
    );

export type ManifestChange =
  | { area: "documents"; key: string }
  | { area: "prompts"; key: string; from: number | null; to: number | null }
  | { area: "templates"; key: string; name: string; what: "added" | "removed" | "name" | "text" }
  | { area: "kinds"; key: string; name: string; what: "added" | "removed" | "model" };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changes from one manifest to another, area by area: each kind of problem whose documents changed, each task
 * whose prompt version changed, each platform model added, removed or changed, each piece kind's model changed.
 * Everything of `to` is new when there is no `from`.
 */
export function manifestChanges(from: ModuleManifest | null, to: ModuleManifest): ManifestChange[] {
  const before: ModuleManifest = from ?? { documents: {}, prompts: {}, templates: {}, kinds: {} };
  const changes: ManifestChange[] = [];
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  for (const key of keys(before.documents, to.documents)) {
    if (!same(before.documents[key], to.documents[key])) changes.push({ area: "documents", key });
  }
  for (const key of keys(before.prompts, to.prompts)) {
    const was = before.prompts[key] ?? null;
    const is = to.prompts[key] ?? null;
    if (was !== is) changes.push({ area: "prompts", key, from: was, to: is });
  }
  for (const key of keys(before.templates, to.templates)) {
    const was = before.templates[key];
    const is = to.templates[key];
    if (!was && is) changes.push({ area: "templates", key, name: is.name, what: "added" });
    else if (was && !is) changes.push({ area: "templates", key, name: was.name, what: "removed" });
    else if (was && is && was.body !== is.body) changes.push({ area: "templates", key, name: is.name, what: "text" });
    else if (was && is && was.name !== is.name) changes.push({ area: "templates", key, name: is.name, what: "name" });
  }
  for (const key of keys(before.kinds, to.kinds)) {
    const was = before.kinds[key];
    const is = to.kinds[key];
    if (!was && is) changes.push({ area: "kinds", key, name: is.name, what: "added" });
    else if (was && !is) changes.push({ area: "kinds", key, name: was.name, what: "removed" });
    else if (was && is && was.model !== is.model) changes.push({ area: "kinds", key, name: is.name, what: "model" });
  }
  return changes;
}
