/**
 * Scaffolder Agent
 *
 * The entry point for every new prompt. When a prompt is ingested, the scaffolder:
 * 1. Classifies the request type from the prompt text
 * 2. Selects the appropriate agent team via ACTIVATION_MAP
 * 3. Broadcasts the context package to each selected agent via agent_messages
 * 4. Emits scaffolder.team.assembled to kick off downstream agent workflows
 * 5. Records the scaffolding event in prompt_pipeline_stages
 */

import { nanoid } from 'nanoid';
import { agentMessages, promptPipelineStages } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';

// Logger shim — replaced at runtime by the real pino logger if available
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    console.warn('[scaffolder]', msg, obj);
  },
};

// ─── Request Classification ──────────────────────────────────────────────────

export type RequestType =
  | 'new-project'
  | 'new-feature'
  | 'bug-fix'
  | 'refactor'
  | 'performance'
  | 'security'
  | 'content';

/**
 * Classifies a prompt text into one of the 7 request types.
 * Uses keyword heuristics — deterministic, no LLM call needed at this stage.
 */
export function classifyRequest(promptText: string): RequestType {
  const lower = promptText.toLowerCase();

  // Security signals — check before bug-fix to avoid misclassifying auth bugs
  if (
    lower.includes('security') ||
    lower.includes('vulnerability') ||
    lower.includes('exploit') ||
    lower.includes('cve') ||
    lower.includes('penetration test') ||
    lower.includes('sql injection') ||
    lower.includes('xss')
  ) return 'security';

  // Bug-fix signals
  if (
    lower.includes('bug') ||
    lower.includes('broken') ||
    lower.includes('fix') ||
    lower.includes('error') ||
    lower.includes('crash') ||
    lower.includes('regression') ||
    lower.includes('not working') ||
    lower.includes("doesn't work") ||
    lower.includes("won't load")
  ) return 'bug-fix';

  // Performance signals
  if (
    lower.includes('performance') ||
    lower.includes('slow') ||
    lower.includes('optimize') ||
    lower.includes('latency') ||
    lower.includes('throughput') ||
    lower.includes('memory leak') ||
    lower.includes('bottleneck')
  ) return 'performance';

  // Refactor signals
  if (
    lower.includes('refactor') ||
    lower.includes('clean up') ||
    lower.includes('restructure') ||
    lower.includes('simplify') ||
    lower.includes('extract') ||
    lower.includes('decouple') ||
    lower.includes('modularize')
  ) return 'refactor';

  // Content signals
  if (
    lower.includes('content') ||
    lower.includes('cms') ||
    lower.includes('blog') ||
    lower.includes('article') ||
    lower.includes('copy') ||
    lower.includes('markdown') ||
    lower.includes('documentation site')
  ) return 'content';

  // New project signals — strong explicit markers
  if (
    lower.includes('new project') ||
    lower.includes('new app') ||
    lower.includes('new website') ||
    lower.includes('new platform') ||
    lower.includes('new system') ||
    lower.includes('new service') ||
    lower.includes('build a ') ||
    lower.includes('build an ') ||
    lower.includes('create a ') ||
    lower.includes('create an ') ||
    lower.includes('start a ') ||
    lower.includes('launch a ') ||
    lower.includes('scaffold a ') ||
    lower.includes('greenfield')
  ) return 'new-project';

  // Default: treat as a new feature
  return 'new-feature';
}

// ─── Activation Map ──────────────────────────────────────────────────────────

/**
 * Maps each request type to the set of agents that should be activated.
 * Agents are listed in rough activation order (earlier = higher priority).
 */
export const ACTIVATION_MAP: Record<RequestType, string[]> = {
  'new-project': [
    'ea-agent',          // Architecture first — defines the technical strategy
    'po-agent',          // Decompose into epics and stories
    'ux-agent',          // Design flows and wireframes
    'domain-classifier', // Label everything by functional domain
    'ba-agent',          // Enrich stories with acceptance criteria
    'task-scheduler',    // Build the dependency DAG
    'platform-agent',    // Provision infra and environments
    'dba-agent',         // Design data model and migrations
    'bff-agent',         // Design API contracts
    'event-manager-agent', // Set up event-driven patterns
    'observability-agent', // Logging, tracing, health checks
    'ui-agent',          // Implement component architecture
    'analytics-agent',   // Instrument tracking
    'testing-agent',     // Write and run tests
    'security-agent',    // Security review
    'release-agent',     // CI/CD and deployment gates
    'docs-agent',        // Documentation
  ],
  'new-feature': [
    'po-agent',
    'domain-classifier',
    'ba-agent',
    'task-scheduler',
    'developer-agent',
    'testing-agent',
    'release-agent',
  ],
  'bug-fix': [
    'developer-agent',
    'testing-agent',
    'release-agent',
    'security-agent',
  ],
  'refactor': [
    'ea-agent',
    'developer-agent',
    'testing-agent',
    'release-agent',
  ],
  'performance': [
    'developer-agent',
    'observability-agent',
    'testing-agent',
    'release-agent',
  ],
  'security': [
    'security-agent',
    'developer-agent',
    'testing-agent',
    'release-agent',
  ],
  'content': [
    'cms-agent',
    'docs-agent',
    'seo-agent',
  ],
};

// ─── Main Scaffolder Function ────────────────────────────────────────────────

/**
 * Core scaffolder logic. Called asynchronously after prompt.ingested event.
 * Does NOT block the HTTP response — fire-and-forget from the route handler.
 */
export async function runScaffolder(
  promptId: string,
  promptText: string,
  projectId: string | null,
  db: Db,
): Promise<void> {
  const requestType = classifyRequest(promptText);
  const agentsToActivate = ACTIVATION_MAP[requestType];
  const correlationId = `scaffold-${promptId}`;
  const now = Date.now();

  // 1. Record a context-broadcast message to each activated agent
  for (const agentName of agentsToActivate) {
    const msgId = `msg-${nanoid(12)}`;
    db.insert(agentMessages).values({
      id: msgId,
      fromAgent: 'scaffolder',
      toAgent: agentName,
      messageType: 'context-broadcast',
      correlationId,
      payload: JSON.stringify({
        promptId,
        promptText,
        projectId,
        requestType,
        activatedAgents: agentsToActivate,
        timestamp: now,
      }),
      status: 'pending',
      createdAt: now,
    }).run();
  }

  // 2. Emit scaffolder.team.assembled event onto the bus
  eventBus.publish({
    type: 'scaffolder.team.assembled',
    actor: 'api',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      requestType,
      agentsActivated: agentsToActivate,
      correlationId,
      projectId,
    },
  });

  // 3. Record scaffolding stage in the prompt pipeline
  try {
    db.insert(promptPipelineStages).values({
      id: `pps-${nanoid(8)}`,
      promptId,
      stage: 'scaffolded',
      entityKind: 'prompt',
      entityId: promptId,
      enteredAt: now,
      metadata: JSON.stringify({ requestType, agentsActivated: agentsToActivate }),
    }).run();
  } catch {
    // Non-fatal: pipeline stage is observability, not critical path
  }

  // 4. Chain Tier-2 agents: PO Agent → BA Agent → Task Scheduler
  //    Fire-and-forget with a brief delay to let the scaffolder event persist first.
  setTimeout(() => {
    // PO Agent runs first (decomposition) — only for request types that include it
    const poChain: Promise<unknown> = agentsToActivate.includes('po-agent')
      ? import('./po-agent')
          .then(({ runPOAgent }) =>
            runPOAgent({ promptId, promptText, projectId, correlationId }, db),
          )
          .catch((err: unknown) => logger.warn({ err }, 'PO Agent failed'))
      : Promise.resolve();

    poChain
      .then(() => {
        // BUCKET-003: EA Agent runs between PO and BA — assigns techSubDomains,
        // qualityTags, risk, effort, blockedBy, claims to every story.
        if (agentsToActivate.includes('ea-agent') || agentsToActivate.includes('ba-agent')) {
          return import('./ea-agent')
            .then(({ runEAAgent }) =>
              runEAAgent({ promptId, correlationId }, db),
            )
            .catch((err: unknown) => logger.warn({ err }, 'EA Agent failed'));
        }
      })
      .then(() => {
        if (agentsToActivate.includes('ba-agent')) {
          return import('./ba-agent')
            .then(({ runBAAgent }) =>
              runBAAgent({ promptId, correlationId }, db),
            );
        }
      })
      .then(() => {
        // TEST-005: Test-Design Agent runs after BA finishes its
        // cross-agent enrichment. It generates test_cases for every
        // valid story, advances the prompt to the `test_designed`
        // pipeline stage, then yields to the Task Scheduler.
        return import('./test-design-agent')
          .then(({ runTestDesignAgent }) =>
            runTestDesignAgent({ promptId, correlationId }, db),
          )
          .then((out) => {
            // Advance the prompt-level pipeline stage once test-design
            // has visited every valid story. We advance even if zero
            // stories were eligible (e.g. all skipped) so downstream
            // consumers always see the stage row appear.
            const { advancePipelineStage } = require('./pipeline-stages') as
              typeof import('./pipeline-stages');
            advancePipelineStage(
              {
                promptId,
                stage: 'test_designed',
                correlationId,
                metadata: {
                  designedStories: out.designedStories,
                  totalTestCases: out.totalTestCases,
                  storiesSkipped: out.storiesSkipped,
                  storiesErrored: out.storiesErrored,
                },
              },
              db,
            );
          })
          .catch((err: unknown) => logger.warn({ err }, 'Test-Design Agent failed'));
      })
      .then(() => {
        if (agentsToActivate.includes('task-scheduler')) {
          return import('./task-scheduler').then(({ runTaskScheduler }) =>
            runTaskScheduler({ promptId, correlationId }, db),
          );
        }
      })
      .catch((err: unknown) =>
        logger.warn({ err }, 'EA / BA / Test-Design / Task Scheduler chain failed'),
      );
  }, 5_000);
}
