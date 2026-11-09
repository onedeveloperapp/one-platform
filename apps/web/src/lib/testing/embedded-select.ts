/**
 * What PostgREST makes of a `select` with embedded resources ("id, people(full_name), files!fk(name)"), written as
 * one SQL statement for the stand-in client of the embedded database (`embedded-db.ts`): each embedded resource is a
 * correlated subquery over the foreign key between the two tables, an object for a row it points to (or that points
 * back to it one to one) and an array for the rows that point to it; `!inner` keeps only the rows that have one, and
 * a filter on an embedded column (`ai_runs.subject_id`) filters that resource (and, when inner, its parent too).
 * The transport stands in, never a rule: row-level security and every function run as they are.
 */

export type SelectNode =
  | { kind: "all" }
  | { kind: "column"; name: string; key: string; arrow: "->" | "->>" | null; field: string | null; cast: string | null }
  | { kind: "embed"; relation: string; key: string; hint: string | null; inner: boolean; children: SelectNode[] };

/** Splits a select list at its top-level commas. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim() !== "") parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

const NAME = /^[a-z_][a-z0-9_]*$/;
/** A column as PostgREST reads it: `column`, `alias:column`, `column::type`, `column->field`, `column->>field`. */
const COLUMN = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:(->>?)([a-z_][a-z0-9_]*))?(?:::([a-z_][a-z0-9_]*))?$/;

/** A select list as PostgREST reads it: its columns (`COLUMN`), `*`, and `relation(!hint|!inner)(...)`. */
export function parseSelect(text: string): SelectNode[] {
  return splitTop(text.replace(/\s+/g, " ")).map((part): SelectNode => {
    if (part === "*") return { kind: "all" };
    const open = part.indexOf("(");
    if (open < 0) {
      const match = COLUMN.exec(part.replace(/\s/g, ""));
      if (!match) throw new Error(`the stand-in does not read the column ${part}`);
      const [, alias, name, arrow, field, cast] = match;
      return {
        kind: "column",
        name,
        // Named as PostgREST names it: its alias, else the field a JSON path reads, else the column, whatever its cast.
        key: alias ?? field ?? name,
        arrow: (arrow as "->" | "->>" | undefined) ?? null,
        field: field ?? null,
        cast: cast ?? null,
      };
    }
    if (!part.endsWith(")")) throw new Error(`the stand-in does not read ${part}`);
    let head = part.slice(0, open).trim();
    const children = parseSelect(part.slice(open + 1, -1));
    let key: string | null = null;
    if (head.includes(":")) [key, head] = head.split(":").map((piece) => piece.trim());
    const [relation, ...marks] = head.split("!").map((piece) => piece.trim());
    if (!NAME.test(relation)) throw new Error(`the stand-in does not read the resource ${part}`);
    const inner = marks.includes("inner");
    const hint = marks.find((mark) => mark !== "inner" && mark !== "left") ?? null;
    return { kind: "embed", relation, key: key ?? relation, hint, inner, children };
  });
}

/** A foreign key between two tables, as the catalog says it. */
export type ForeignKey = {
  name: string;
  from: string;
  to: string;
  fromColumns: string[];
  toColumns: string[];
  /** The referencing columns are unique: one row points back to a row at most. */
  uniqueFrom: boolean;
};

export const FOREIGN_KEYS_SQL = `
  select c.conname as name, f.relname as "from", t.relname as "to",
    (select array_agg(a.attname::text order by k.i) from unnest(c.conkey) with ordinality k (n, i)
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as "fromColumns",
    (select array_agg(a.attname::text order by k.i) from unnest(c.confkey) with ordinality k (n, i)
       join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) as "toColumns",
    exists (
      select 1 from pg_constraint u
      where u.conrelid = c.conrelid and u.contype in ('u', 'p')
        and (select array_agg(x order by x) from unnest(u.conkey) x) = (select array_agg(x order by x) from unnest(c.conkey) x)
    ) as "uniqueFrom"
  from pg_constraint c
  join pg_class f on f.oid = c.conrelid
  join pg_class t on t.oid = c.confrelid
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and ((f.relname = $1 and t.relname = $2) or (f.relname = $2 and t.relname = $1))
  order by c.conname`;

/**
 * The key an embedded resource goes by: the one its hint names (a key's name, or a column of it), or the only one;
 * among several with no hint, the one from the parent to the resource that is not a part of another (PostgREST
 * itself refuses such a select, so the app never writes one).
 */
export function chooseKey(keys: ForeignKey[], parent: string, hint: string | null): ForeignKey {
  if (keys.length === 0) throw new Error(`the stand-in finds no foreign key from ${parent}`);
  if (hint) {
    const named = keys.find(
      (key) => key.name === hint || key.fromColumns.includes(hint) || key.toColumns.includes(hint),
    );
    if (!named) throw new Error(`the stand-in finds no foreign key ${hint}`);
    return named;
  }
  if (keys.length === 1) return keys[0];
  const widest = [...keys].sort((a, b) => b.fromColumns.length - a.fromColumns.length);
  return widest.find((key) => key.from === parent) ?? widest[0];
}

/** A filter on an embedded resource, by the resource's key in the select. */
export type EmbeddedFilter = { path: string; clause: (alias: string) => string; values: string[] };

type Compile = {
  keyOf: (parent: string, relation: string, hint: string | null) => Promise<ForeignKey>;
  filters: EmbeddedFilter[];
  values: string[];
};

let aliases = 0;
const nextAlias = () => `e${(aliases += 1)}`;

/** Puts a filter's values into the statement's own list, each "?" its "$n". */
function bind(state: Compile, clause: string, values: string[]): string {
  return values.reduce((text, value) => {
    state.values.push(value);
    return text.replace("?", `$${state.values.length}`);
  }, clause);
}

/** The join of an embedded resource to its parent, and whether it is one row (an object) or many (an array). */
async function joinOf(state: Compile, parent: { table: string; alias: string }, node: SelectNode & { kind: "embed" }) {
  const key = await state.keyOf(parent.table, node.relation, node.hint);
  const alias = nextAlias();
  const pointsOut = key.from === parent.table && key.to === node.relation;
  const on = pointsOut
    ? key.fromColumns.map((column, at) => `${alias}.${key.toColumns[at]} = ${parent.alias}.${column}`)
    : key.fromColumns.map((column, at) => `${alias}.${column} = ${parent.alias}.${key.toColumns[at]}`);
  return { alias, on: on.join(" and "), single: pointsOut || key.uniqueFrom };
}

/** A column of a row as SQL reads it, with its JSON path and its cast. */
function columnSql(alias: string, node: SelectNode & { kind: "column" }): string {
  const read = node.arrow ? `${alias}.${node.name}${node.arrow}'${node.field}'` : `${alias}.${node.name}`;
  return node.cast ? `(${read})::${node.cast}` : read;
}

/** The filters the select's caller wrote on this resource (`path` is its key, or a nested key joined by dots). */
function filtersOn(state: Compile, path: string, alias: string): string[] {
  return state.filters
    .filter((filter) => filter.path === path)
    .map((filter) => bind(state, filter.clause(alias), filter.values));
}

/** The JSON of one row of a resource: its columns, `*`, and its own embedded resources. */
async function rowJson(
  state: Compile,
  table: string,
  alias: string,
  nodes: SelectNode[],
  path: string,
): Promise<string> {
  const pairs: string[] = [];
  let all = false;
  for (const node of nodes) {
    if (node.kind === "all") all = true;
    else if (node.kind === "column") pairs.push(`'${node.key}', ${columnSql(alias, node)}`);
    else pairs.push(`'${node.key}', (${await embedSql(state, { table, alias }, node, `${path}.${node.key}`)})`);
  }
  const built = pairs.length > 0 ? `jsonb_build_object(${pairs.join(", ")})` : "'{}'::jsonb";
  return all ? `to_jsonb(${alias}) || ${built}` : built;
}

/** An embedded resource as a correlated subquery: its object, or the array of its rows. */
async function embedSql(
  state: Compile,
  parent: { table: string; alias: string },
  node: SelectNode & { kind: "embed" },
  path: string,
): Promise<string> {
  const { alias, on, single } = await joinOf(state, parent, node);
  const where = [on, ...filtersOn(state, path, alias)].join(" and ");
  const json = await rowJson(state, node.relation, alias, node.children, path);
  return single
    ? `select ${json} from public.${node.relation} ${alias} where ${where} limit 1`
    : `select coalesce(jsonb_agg(${json}), '[]'::jsonb) from public.${node.relation} ${alias} where ${where}`;
}

/**
 * The projection of a select with embedded resources over `table` (aliased `t0`), and the conditions its inner
 * resources put on the parent's rows. The values of the embedded filters go into `values`, in the order of the "$n"
 * they are bound to; the caller numbers its own filters after them.
 */
export async function compileSelect(input: {
  table: string;
  nodes: SelectNode[];
  filters: EmbeddedFilter[];
  keyOf: Compile["keyOf"];
  values: string[];
}): Promise<{ projection: string; conditions: string[] }> {
  const state: Compile = { keyOf: input.keyOf, filters: input.filters, values: input.values };
  const parent = { table: input.table, alias: "t0" };
  const columns: string[] = [];
  const conditions: string[] = [];
  for (const node of input.nodes) {
    if (node.kind === "all") columns.push("t0.*");
    else if (node.kind === "column") columns.push(`${columnSql("t0", node)} as "${node.key}"`);
    else {
      columns.push(`(${await embedSql(state, parent, node, node.key)}) as "${node.key}"`);
      if (node.inner) {
        const { alias, on } = await joinOf(state, parent, node);
        const where = [on, ...filtersOn(state, node.key, alias)].join(" and ");
        conditions.push(`exists (select 1 from public.${node.relation} ${alias} where ${where})`);
      }
    }
  }
  return { projection: columns.join(", "), conditions };
}
