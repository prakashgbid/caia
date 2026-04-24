# Changesets

This directory contains pending changesets. Each `.md` file (other than this README) represents a version bump waiting to be applied.

## Adding a changeset

```bash
pnpm changeset
```

Follow the interactive prompts to select affected packages and bump type (patch/minor/major).

## Releasing

The `release.yml` CI workflow handles versioning and publishing automatically on merge to `main`.
