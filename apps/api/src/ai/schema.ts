/**
 * JSON-schema shaping for each provider's structured-output dialect. All our schemas are
 * zod v4 objects; zod emits draft-2020 JSON schema with `additionalProperties: false`.
 */
import { z } from "zod/v4";

export type JsonSchema = Record<string, unknown>;

export function baseJsonSchema(schema: z.ZodType): JsonSchema {
  const js = z.toJSONSchema(schema) as JsonSchema;
  delete js.$schema;
  return js;
}

function isNullable(s: JsonSchema): boolean {
  const anyOf = s.anyOf as JsonSchema[] | undefined;
  return !!anyOf?.some((x) => x.type === "null") || s.type === "null" || (Array.isArray(s.type) && (s.type as string[]).includes("null"));
}

/**
 * OpenAI "strict" dialect: every property listed in `required`, optional ones made nullable,
 * `additionalProperties: false` everywhere, no numeric bounds beyond what strict accepts.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const walk = (s: JsonSchema): JsonSchema => {
    const out: JsonSchema = { ...s };
    delete out.minimum;
    delete out.maximum;
    if (out.type === "object" && out.properties) {
      const props = out.properties as Record<string, JsonSchema>;
      const required = new Set((out.required as string[] | undefined) ?? []);
      const next: Record<string, JsonSchema> = {};
      for (const [k, v] of Object.entries(props)) {
        let child = walk(v);
        if (!required.has(k) && !isNullable(child)) child = { anyOf: [child, { type: "null" }], ...(child.description ? { description: child.description } : {}) };
        next[k] = child;
      }
      out.properties = next;
      out.required = Object.keys(next);
      out.additionalProperties = false;
    }
    if (out.items) out.items = walk(out.items as JsonSchema);
    if (Array.isArray(out.anyOf)) out.anyOf = (out.anyOf as JsonSchema[]).map(walk);
    return out;
  };
  return walk(baseJsonSchema(schema));
}

/**
 * Gemini `responseSchema` (OpenAPI 3.0 subset): `nullable` instead of anyOf-with-null, no
 * `additionalProperties`, no `$schema`, integer bounds dropped.
 */
export function toGeminiSchema(schema: z.ZodType): JsonSchema {
  const walk = (s: JsonSchema): JsonSchema => {
    let out: JsonSchema = { ...s };
    delete out.additionalProperties;
    delete out.minimum;
    delete out.maximum;
    if (Array.isArray(out.anyOf)) {
      const parts = (out.anyOf as JsonSchema[]).filter((x) => x.type !== "null");
      const nullable = parts.length !== (out.anyOf as JsonSchema[]).length;
      if (parts.length === 1) {
        const desc = out.description;
        out = { ...walk(parts[0]!), ...(nullable ? { nullable: true } : {}), ...(desc ? { description: desc } : {}) };
        return out;
      }
      out.anyOf = parts.map(walk);
      if (nullable) out.nullable = true;
    }
    if (out.type === "object" && out.properties) {
      const required = new Set((out.required as string[] | undefined) ?? []);
      out.properties = Object.fromEntries(
        Object.entries(out.properties as Record<string, JsonSchema>).map(([k, v]) => {
          const child = walk(v);
          return [k, required.has(k) ? child : { ...child, nullable: true }];
        }),
      );
    }
    if (out.items) out.items = walk(out.items as JsonSchema);
    return out;
  };
  return walk(baseJsonSchema(schema));
}

/**
 * Strict-mode providers must emit every key, so optional fields come back as `null`. Our zod
 * schemas say `optional()` (undefined), so drop nulls where the base schema did not require
 * the key and did not itself allow null.
 */
export function stripNullsForOptionals(data: unknown, schema: z.ZodType): unknown {
  const walk = (value: unknown, js: JsonSchema | undefined): unknown => {
    if (!js || value == null) return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, js.items as JsonSchema | undefined));
    if (typeof value === "object" && js.type === "object" && js.properties) {
      const props = js.properties as Record<string, JsonSchema>;
      const required = new Set((js.required as string[] | undefined) ?? []);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const child = props[k];
        if (v === null && child && !required.has(k) && !isNullable(child)) continue;
        out[k] = walk(v, child);
      }
      return out;
    }
    if (typeof value === "object" && Array.isArray(js.anyOf)) {
      const obj = (js.anyOf as JsonSchema[]).find((x) => x.type === "object");
      return walk(value, obj);
    }
    return value;
  };
  return walk(data, baseJsonSchema(schema));
}
