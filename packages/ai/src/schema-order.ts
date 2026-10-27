/**
 * The properties of a JSON Schema in the order the task meant them.
 *
 * A model with structured output writes an answer's properties in the order
 * its schema lists them, and decides each as it writes it: a field written
 * before the one it depends on is decided blind. The schemas of the tasks
 * are kept in the database as jsonb, which keeps an object's keys in an
 * order of its own (the shortest first), never the order they were written
 * in; `required` is an array, and arrays keep their order. So the properties
 * go in the order `required` names them, and the ones it leaves out after
 * them, as they came. Found with the real model on 2026-10-26: the reading
 * of a hearing listed `data` before `ha_audiencia` and `trecho`, and the
 * model wrote no day every time.
 */
export function inRequiredOrder(properties: Record<string, unknown>, required: unknown): [string, unknown][] {
  const named = Array.isArray(required)
    ? required.filter(
        (key): key is string => typeof key === "string" && Object.prototype.hasOwnProperty.call(properties, key),
      )
    : [];
  const first = [...new Set(named)];
  const rest = Object.keys(properties).filter((key) => !first.includes(key));
  return [...first, ...rest].map((key) => [key, properties[key]]);
}
