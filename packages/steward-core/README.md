# @chiefaia/steward-core

DevOps Steward Agent — process-graph evaluator (propose-only, P0).

## Purpose

Codifies the lifecycle of CAIA monorepo processes (Git Flow, release, deploy,
worktree hygiene, daemon health, etc.) as YAML files. Evaluates observed
events against expected sequences and emits `process_drift` events when the
system diverges from policy.

P0 ships with a single codified process: `post-release-back-merge` — the rule
that was missed in the 2026-04-30 back-merge incident.

## Status

**Propose-only.** This package detects drift and writes observation rows. A
future PR (P5) wires the actor module that translates drifts into Capability
Broker token requests for risk-tiered auto-fix.

## Design

See `~/Documents/projects/reports/devops-steward-agent-design-2026-05-03.md`
for the full architecture, sequenced PR plan, and risk tiering.

## Public API

```typescript
import {
  loadProcessGraph,
  evaluateProcess,
  type Process,
  type StewardEvent,
  type ProcessDrift,
} from '@chiefaia/steward-core';

const processes = await loadProcessGraph('./processes');
const drift = evaluateProcess(processes[0], events, { now: Date.now() });
if (drift) {
  // record to smart_cicd_observations
}
```
