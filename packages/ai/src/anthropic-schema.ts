import { inRequiredOrder } from "@flyee/ai/schema-order";

/**
 * Convert a task's JSON Schema into what Anthropic's structured output takes
 * and follows well (`output_config.format`).
 *
 * WHY THIS IS A CONVERSION AND NOT A RULE THE SCHEMAS SHOULD FOLLOW (as for
 * OpenAI, `strict-schema.ts`): the schemas say what a task's answer is, its
 * limits included, and the task's reader and the database check them; one
 * provider's dialect is that provider's to translate.
 *
 * Two things, both found with the real model on 2026-10-26:
 *
 *   Order. The properties go in the order `required` names them
 *   (`schema-order.ts`): the model writes them in the schema's order.
 *
 *   Limits the API does not take. A number's `minimum`, `maximum`,
 *   `exclusiveMinimum`, `exclusiveMaximum` and `multipleOf`, a string's
 *   `minLength` and `maxLength`, an array's `maxItems` and a `minItems` above
 *   1 make the request a 400 (the reading of a term's days had `minimum` and
 *   `maximum`, and never reached the model). They are left out of the schema
 *   and said in the property's description instead, as Anthropic's own SDK
 *   helpers do, so the model still reads them; the answer is still checked
 *   against the schema as written.
 *
 * The transform is idempotent.
 */

type JsonSchema = Record<string, unknown>;

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const LEFT_OUT = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
]);

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The limits left out of a schema, as words for its description. */
function limitWords(schema: JsonSchema): string[] {
  const words: string[] = [];
  if (isNumber(schema.minimum) && isNumber(schema.maximum)) {
    words.push(`Entre ${schema.minimum} e ${schema.maximum}.`);
  } else {
    if (isNumber(schema.minimum)) words.push(`No mínimo ${schema.minimum}.`);
    if (isNumber(schema.maximum)) words.push(`No máximo ${schema.maximum}.`);
  }
  if (isNumber(schema.exclusiveMinimum)) words.push(`Maior que ${schema.exclusiveMinimum}.`);
  if (isNumber(schema.exclusiveMaximum)) words.push(`Menor que ${schema.exclusiveMaximum}.`);
  if (isNumber(schema.multipleOf)) words.push(`Múltiplo de ${schema.multipleOf}.`);
  if (isNumber(schema.minLength) && schema.minLength > 0) words.push(`No mínimo ${schema.minLength} caracteres.`);
  if (isNumber(schema.maxLength)) words.push(`No máximo ${schema.maxLength} caracteres.`);
  if (isNumber(schema.minItems) && schema.minItems > 1) words.push(`No mínimo ${schema.minItems} itens.`);
  if (isNumber(schema.maxItems)) words.push(`No máximo ${schema.maxItems} itens.`);
  return words;
}

/** A map of schemas (`$defs`), each converted. */
const eachOf = (value: unknown): unknown =>
  isObject(value)
    ? Object.fromEntries(Object.entries(value).map(([key, schema]) => [key, toAnthropicJsonSchema(schema)]))
    : value;

export function toAnthropicJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => toAnthropicJsonSchema(entry));
  if (!isObject(schema)) return schema;

  const next: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (LEFT_OUT.has(key)) continue;
    if (key === "minItems" && isNumber(value) && value > 1) continue;
    if (key === "properties" && isObject(value)) {
      next.properties = Object.fromEntries(
        inRequiredOrder(value, schema.required).map(([name, property]) => [name, toAnthropicJsonSchema(property)]),
      );
    } else if (key === "items" || key === "anyOf" || key === "allOf" || key === "oneOf" || key === "not") {
      next[key] = toAnthropicJsonSchema(value);
    } else if (key === "additionalProperties" && isObject(value)) {
      next[key] = toAnthropicJsonSchema(value);
    } else if (key === "$defs" || key === "definitions") {
      next[key] = eachOf(value);
    } else {
      next[key] = value;
    }
  }

  const words = limitWords(schema);
  if (words.length > 0) {
    const said = typeof schema.description === "string" ? schema.description.trim() : "";
    // Idempotent: words already said are not said twice.
    const missing = words.filter((word) => !said.includes(word));
    if (missing.length > 0) next.description = [said, ...missing].filter(Boolean).join(" ");
  }
  return next;
}
