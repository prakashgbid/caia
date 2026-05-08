# AGENTS.md (fixture)

A minimal AGENTS.md fixture used by Reviewer's test suite. Real CAIA AGENTS.md
lives at the repo root and is read at runtime.

## Code style

- TypeScript strict.
- No `any`.
- Functions <60 lines.
- No nesting >4 levels.
- camelCase for variables and functions; PascalCase for types and classes.

## Testing conventions

- Vitest for new packages.
- Tests assert on behaviour, not implementation.

## Naming

- Identifiers should be self-describing.
- Single-letter names only for common iter (i/j/k/x/y/n/t/e).

## Some other unrelated heading

This section should be ignored by the conventions loader.
