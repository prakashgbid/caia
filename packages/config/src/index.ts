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

export function loadConfig<T extends Record<string, unknown>>(
  schema: ConfigSchema<T>,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ConfigValues<T> {
  const result = {} as Record<string, unknown>;
  const errors: string[] = [];

  for (const [key, spec] of Object.entries(schema) as [string, ConfigSchema<T>[keyof T]][]) {
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

  return Object.freeze(result) as ConfigValues<T>;
}
