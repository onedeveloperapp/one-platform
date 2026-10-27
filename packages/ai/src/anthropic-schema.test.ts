import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAnthropicJsonSchema } from "./anthropic-schema.ts";

/**
 * Both halves of the conversion were found with the real model: a schema whose properties came in the database's
 * order had the model decide a hearing's day before it looked for the hearing, and a schema with a number's
 * limits was refused by the API. These cases pin the order, what is left out and where it is said instead.
 */

// The reading of a hearing as the database keeps it: its keys in jsonb's order, the shortest first.
const HEARING = {
  type: "object",
  additionalProperties: false,
  required: ["ha_audiencia", "situacao", "data", "hora", "tipo", "modo", "local", "link", "trecho", "observacoes"],
  properties: {
    data: { type: ["string", "null"], pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    hora: { type: ["string", "null"], pattern: "^[0-9]{2}:[0-9]{2}$" },
    link: { type: ["string", "null"], maxLength: 500 },
    modo: { type: "string", enum: ["presencial", "videoconferencia", "hibrida"] },
    tipo: { type: "string", enum: ["conciliacao", "instrucao", "una", "outra"] },
    local: { type: ["string", "null"], maxLength: 300 },
    trecho: { type: "string", maxLength: 600 },
    situacao: { type: "string", enum: ["marcada", "redesignada", "cancelada", "outra"] },
    observacoes: { type: "string", maxLength: 300 },
    ha_audiencia: { type: "boolean" },
  },
};

// The reading of a term: a number of days with its limits, which the API refuses.
const TERM = {
  type: "object",
  additionalProperties: false,
  required: ["ha_prazo", "dias", "contagem", "a_partir", "ato", "trecho", "observacoes"],
  properties: {
    ato: { type: ["string", "null"] },
    dias: { type: ["integer", "null"], minimum: 1, maximum: 365 },
    trecho: { type: "string", maxLength: 600 },
    a_partir: { type: "string", enum: ["publicacao", "outro"] },
    contagem: { type: "string", enum: ["uteis", "corridos"] },
    ha_prazo: { type: "boolean" },
    observacoes: { type: "string", maxLength: 300 },
  },
};

const LEFT_OUT = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
];

/** Every key anywhere in a schema. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("toAnthropicJsonSchema", () => {
  it("lists the properties in the order the task's `required` names them", () => {
    const converted = toAnthropicJsonSchema(HEARING) as { properties: Record<string, unknown> };
    assert.deepEqual(Object.keys(converted.properties), HEARING.required);
  });

  it("puts what `required` leaves out after it, as it came", () => {
    const converted = toAnthropicJsonSchema({
      type: "object",
      required: ["b"],
      properties: { z: { type: "string" }, a: { type: "string" }, b: { type: "string" } },
    }) as { properties: Record<string, unknown> };
    assert.deepEqual(Object.keys(converted.properties), ["b", "z", "a"]);
  });

  it("orders the objects inside arrays and unions too", () => {
    const converted = toAnthropicJsonSchema({
      type: "object",
      required: ["trechos"],
      properties: {
        trechos: {
          type: "array",
          items: {
            type: "object",
            required: ["voo", "de", "para"],
            properties: { de: { type: "string" }, voo: { type: "string" }, para: { type: "string" } },
          },
        },
      },
    }) as { properties: { trechos: { items: { properties: Record<string, unknown> } } } };
    assert.deepEqual(Object.keys(converted.properties.trechos.items.properties), ["voo", "de", "para"]);
  });

  it("leaves out the limits the API refuses, and says them in the description instead", () => {
    const converted = toAnthropicJsonSchema(TERM) as { properties: Record<string, Record<string, unknown>> };
    assert.deepEqual(
      keysOf(converted).filter((key) => LEFT_OUT.includes(key)),
      [],
    );
    assert.equal(converted.properties.dias.description, "Entre 1 e 365.");
    assert.equal(converted.properties.trecho.description, "No máximo 600 caracteres.");
    assert.deepEqual(converted.properties.dias.type, ["integer", "null"]);
  });

  it("keeps what the API takes: a pattern, an enum, a closed object, a minItems of 1", () => {
    const converted = toAnthropicJsonSchema({
      type: "object",
      additionalProperties: false,
      required: ["dias", "lista"],
      properties: {
        dias: { type: "string", pattern: "^[0-9]+$", enum: ["1", "2"] },
        lista: { type: "array", minItems: 1, maxItems: 9, items: { type: "string" } },
      },
    }) as { additionalProperties: unknown; properties: Record<string, Record<string, unknown>> };
    assert.equal(converted.additionalProperties, false);
    assert.equal(converted.properties.dias.pattern, "^[0-9]+$");
    assert.deepEqual(converted.properties.dias.enum, ["1", "2"]);
    assert.equal(converted.properties.lista.minItems, 1);
    assert.equal(converted.properties.lista.maxItems, undefined);
    assert.equal(converted.properties.lista.description, "No máximo 9 itens.");
  });

  it("keeps a description the schema had, and adds the limits after it", () => {
    const converted = toAnthropicJsonSchema({ type: "string", description: "O trecho copiado.", maxLength: 600 }) as {
      description: string;
    };
    assert.equal(converted.description, "O trecho copiado. No máximo 600 caracteres.");
  });

  it("is idempotent", () => {
    const once = toAnthropicJsonSchema(TERM);
    assert.deepEqual(toAnthropicJsonSchema(once), once);
    const hearing = toAnthropicJsonSchema(HEARING);
    assert.deepEqual(toAnthropicJsonSchema(hearing), hearing);
  });
});
