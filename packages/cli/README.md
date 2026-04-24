# @chiefaia/cli

The `caia` CLI — scaffold CAIA utilities, sites, and agents.

## Install

```bash
npm install -g @chiefaia/cli
```

## Commands

### `caia new utility <name>`

Creates a new `@chiefaia/<name>` package inside the current CAIA monorepo at `packages/<name>/`.

```bash
caia new utility my-utility
caia new utility my-utility --dry-run   # preview without writing
```

### `caia new site <name>`

Scaffolds a standalone Tier-5 site repo outside the monorepo.

```bash
caia new site my-site --domain my-site.com
```

### `caia new agent <name>`

Tier-4 agent scaffolding — coming in a future release.

### `caia doctor`

Audits a repository for CAIA compliance.

```bash
caia doctor                  # audit current directory
caia doctor --repo ../other  # audit another path
```
