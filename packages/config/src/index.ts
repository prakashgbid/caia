import { z } from 'zod';
import { ConfigurationError } from '@chiefaia/errors';

export type ConfigSchema<T> = {
  [K in keyof T]: {
    env?: string;
    default?: T[K];
    required?: boolean;
    parse?: (raw: string) => T[K];
  };
};

export type ConfigValues<T> = Readonly<T>;

/**
 * Overload 1: Zod-schema-based loading.
 * Parses process.env (or provided source) via `schema.parse()` and returns
 * the fully-typed, Zod-validated config object.
 */
export function loadConfig<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  source?: Record<string, string | undefined>,
): z.infer<T>;

/**
 * Overload 2: Record-schema loading (original API — backward compatible).
 */
export function loadConfig<T extends Record<string, unknown>>(
  schema: ConfigSchema<T>,
  source?: Record<string, string | undefined>,
): ConfigValues<T>;

export function loadConfig<T>(
  schema: z.ZodObject<z.ZodRawShape> | ConfigSchema<T>,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): unknown {
  // Detect Zod schema: ZodObject has a `_def` with typeName
  if (schema instanceof z.ZodObject) {
    try {
      return schema.parse(source);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const messages = (err.issues ?? []).map((issue) => {
          const path = issue.path.map(String).join('.');
          return `${path}: ${issue.message}`;
        });
        throw new ConfigurationError(`Configuration validation failed:\n${messages.join('\n')}`);
      }
      throw err;
    }
  }

  // Original record-schema path
  const recordSchema = schema as ConfigSchema<Record<string, unknown>>;
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, spec] of Object.entries(recordSchema)) {
    const raw = spec.env ? source[spec.env] : undefined;

    if (raw !== undefined && raw !== '') {
      result[key] = spec.parse ? spec.parse(raw) : raw;
    } else if (spec.default !== undefined) {
      result[key] = spec.default;
    } else if (spec.required) {
      errors.push(`Missing required config: ${key}${spec.env ? ` (env: ${spec.env})` : ''}`);
    }
  }

  if (errors.length > 0) {
    throw new ConfigurationError(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return Object.freeze(result);
}

// Re-export zod so consumers can build schemas without a separate import
export { z };
