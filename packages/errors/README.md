# @chiefaia/errors

Typed error hierarchy for CAIA applications.

## Install

```bash
pnpm add @chiefaia/errors
```

## Errors

| Class | Code | Status |
|-------|------|--------|
| `CaiaError` | any | base |
| `ValidationError` | `VALIDATION_ERROR` | — |
| `NotFoundError` | `NOT_FOUND` | 404 |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 |
| `ConfigurationError` | `CONFIGURATION_ERROR` | — |

## Usage

```ts
import { NotFoundError, isCaiaError, serializeError } from '@chiefaia/errors';

throw new NotFoundError('User', userId);

// In a global error handler:
if (isCaiaError(err)) {
  res.status(err.statusCode ?? 500).json(err.serialize());
}
```
