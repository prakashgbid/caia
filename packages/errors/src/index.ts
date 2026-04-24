export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly statusCode?: number;
  readonly cause?: SerializedError;
  readonly stack?: string;
}

export class CaiaError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaiaError';
    this.code = code;
  }

  serialize(): SerializedError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      cause: this.cause instanceof CaiaError ? this.cause.serialize() : undefined,
    };
  }
}

export class ValidationError extends CaiaError {
  readonly fields: Record<string, string[]>;

  constructor(message: string, fields: Record<string, string[]> = {}, options?: ErrorOptions) {
    super(message, 'VALIDATION_ERROR', options);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class NotFoundError extends CaiaError {
  readonly statusCode = 404;

  constructor(resource: string, id?: string) {
    super(id ? `${resource} '${id}' not found` : `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends CaiaError {
  readonly statusCode = 401;

  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ConfigurationError extends CaiaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', options);
    this.name = 'ConfigurationError';
  }
}

export function isCaiaError(err: unknown): err is CaiaError {
  return err instanceof CaiaError;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof CaiaError) return err.serialize();
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'UnknownError', message: String(err) };
}
