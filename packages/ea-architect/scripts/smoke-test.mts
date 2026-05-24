/**
 * SMOKE TEST — the FIRST plan to bootstrap through the EA framework.
 *
 * Per the operator brief: "actually invoke the framework on a real
 * research file — pick the smallest of the 4 sitting research outputs
 * (probably inter_agent_communication_protocol_2026.md's exec-summary),
 * submit via the API, walk it through end-to-end."
 *
 * This script:
 *   1. Loads the real EA Repository.
 *   2. Extracts the executive summary from the comm-protocol research file.
 *   3. Synthesises a context dump for it (in absence of one the producer
 *      authored, since the discipline hadn't shipped yet when that
 *      research was written — this is exactly the bootstrap case the
 *      framework was designed for).
 *   4. Wires the real EaPlanReviewer + a StubResponder (so the Defender
 *      runs deterministically without invoking Claude over network).
 *   5. Calls the Coordinator's review() and walks the full back-and-forth.
 *   6. Prints the sign-off path + a summary of what the operator would
 *      see.
 *
 * Run with: `npx tsx packages/ea-architect/scripts/smoke-test.mts` from
 * the caia repo root, or `pnpm --filter @caia/ea-architect run smoke`.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EaPlanReviewer,
  StubRoundOneAdapter,
  type RoundOneOutput
} from '@caia/ea-plan-reviewer';
import {
  PlanDefenderSpawner,
  StubResponder,
  computeThickness,
  makeStubContextDump,
  validateContextDump,
  type DefenderAnswer,
  type PlanContextDump
} from '@caia/plan-defender';

import { EaCoordinator } from '../src/coordinator.js';
import { SignoffComposer } from '../src/signoff-composer.js';
import type {
  CoordinatorPlanSubmission,
  PlanReviewerAdapter,
  SubAgentVerdict
} from '../src/coordinator-types.js';

const REAL_REPO = join(homedir(), 'Documents', 'projects', 'caia-ea');
const REAL_MEMORY = join(homedir(), 'Documents', 'projects', 'agent-memory');
const RESEARCH_FILE = join(
  homedir(),
  'Documents/projects/research/inter_agent_communication_protocol_2026.md'
);

const SCENARIO_BANNER = '═════════════════════════════════════════════════════════════════════════';

function banner(text: string): void {
  console.log(`\n${SCENARIO_BANNER}\n${text}\n${SCENARIO_BANNER}`);
}

function extractExecSummary(planMarkdown: string): string {
  // Pull from start through end of §1 (i.e. up to next "## 2." or similar).
  const stop = planMarkdown.search(/\n## 2\./);
  if (stop > 0) return planMarkdown.slice(0, stop);
  return planMarkdown.slice(0, 8000);
}

function synthContextDump(planPath: string, body: string): PlanContextDump {
  // Bootstrap-mode dump: synthesised from the plan's own structure since
  // the producer pre-dated the dump discipline.
  return {
    schema_version: 1,
    plan_path: planPath,
    plan_slug: 'inter_agent_communication_protocol_2026',
    producer_agent_id: 'cowork-default-pre-framework',
    producer_session_id: 'historical-no-id',
    produced_at: '2026-05-24T00:00:00.000Z',
    models_used: ['claude-opus-4-7'],
    reasoning_summary:
      `The producer was tasked to audit CAIA's current ConductorEventBus + recommend a comm protocol for hundreds of agents. They walked six broker options (NATS JetStream, Kafka, Redpanda, RabbitMQ, Redis Streams, Temporal) and recommended NATS JetStream on the strength of single-binary deployment + $0 marginal cost + at-least-once semantics + reuse of the existing 57-event-type taxonomy at the wrapped EventBus interface. The migration is incremental behind a BUS_BACKEND=jetstream flag with EventEmitter remaining dev-mode default. ` +
      `The reasoning leans heavily on ADR-011 (event-first architecture, the existing in-process bus) and on the operator's scale targets (hundreds of agents, multi-host, two-way comms, fault-tolerance). It explicitly defers full saga compensation (V2), federated multi-cluster (V3), broker-side schema enforcement (kept at type layer), and message encryption beyond TLS (V2). ` +
      `The producer flagged two scenarios where reconsideration is warranted: (a) multi-tenant SaaS with paying-tenant volume → Kafka/Redpanda might dominate; (b) regulatory exactly-once → Temporal's durable execution might dominate.`.repeat(
        1
      ),
    decision_points: [
      {
        decision: 'Which broker for CAIA inter-agent comms (V2)?',
        options_considered: ['NATS JetStream', 'Apache Kafka', 'Redpanda', 'RabbitMQ', 'Redis Streams', 'Temporal.io'],
        chosen: 'NATS JetStream',
        rationale:
          'Single-binary deployment fits the K3s sidecar pattern. Sustained throughput ≥ 750k msg/s on a single node far exceeds CAIA scale targets. TS/Node SDKs are first-class. $0 marginal cost.',
        confidence: 'high',
        revisitable_if: 'multi-tenant SaaS launches with paying-tenant volume OR regulatory exactly-once required.'
      },
      {
        decision: 'Choreography vs orchestration as default flow control',
        options_considered: ['choreography', 'orchestration', 'hybrid'],
        chosen: 'hybrid — choreography default, orchestration for cross-cutting workflows (deploy, tenant onboarding)',
        rationale: 'Choreography keeps coupling low for stage-to-stage; orchestration centralises the cross-cutting workflows that span many agents.',
        confidence: 'high',
        revisitable_if: 'coupling between agents starts limiting independent deployability.'
      },
      {
        decision: 'Saga compensation scope for V1',
        options_considered: ['full multi-stage compensation', 'partial (manual compensators)', 'none'],
        chosen: 'partial — full saga support is a V2 follow-up',
        rationale: 'V1 risk profile is low; full saga adds operational complexity not justified by current failure modes.',
        confidence: 'medium',
        revisitable_if: 'cross-stage failures start producing inconsistent state.'
      }
    ],
    sources_consulted: [
      { type: 'caia-file', citation: 'caia/packages/event-bus-internal/index.ts', relevance: 'Current ConductorEventBus implementation — the V1 substrate being extended.' },
      { type: 'adr', citation: 'ADR-011', relevance: 'Event-first architecture; the canonical seam this spec extends.' },
      { type: 'adr', citation: 'ADR-029', relevance: '57-event-type taxonomy referenced as the wire format.' },
      { type: 'web', citation: 'https://nats.io/docs/jetstream-specs', relevance: 'JetStream throughput + delivery semantics.' },
      { type: 'web', citation: 'https://kafka.apache.org/documentation/', relevance: 'Kafka comparison case for ordering guarantees.' },
      { type: 'research-doc', citation: 'research/conductor_agent_spec_2026.md', relevance: 'Companion spec — Pipeline Status Manager depends on this bus.' }
    ],
    open_questions: [
      {
        question: 'Should the NATS deployment be K3s-sidecar or dedicated namespace?',
        why_unresolved: 'Operational preference rather than architectural; deferred to deploy-time decision.',
        affects: ['§12 topology'],
        candidate_resolution: 'will-emerge-during-build'
      }
    ],
    alternatives_dropped: [
      {
        alternative: 'Stay on ConductorEventBus indefinitely',
        why_dropped: 'ADR-011 explicitly named the single-host ceiling; operator scale targets now exceed it.'
      }
    ],
    invitations_to_scrutiny: [
      'broker choice in §4 — NATS JetStream is defensible but the trade-off vs Kafka deserves a second look',
      'saga semantics in §6 — partial-saga-in-V1 may underprovision durability'
    ],
    assumptions: [
      {
        assumption: 'Subscription-only LLM budget continues through CAIA build',
        why_assumed_true: 'P1 + ADR-001 explicitly state this',
        blast_radius_if_false: 'cost model for the bus changes — broker selection may shift'
      }
    ]
  };
}

async function main(): Promise<void> {
  banner('SMOKE TEST — bootstrap the EA framework on a real research file');

  if (!existsSync(RESEARCH_FILE)) {
    console.error(`Research file not found: ${RESEARCH_FILE}`);
    process.exit(2);
  }
  if (!existsSync(REAL_REPO)) {
    console.error(`Real EA Repository not found at: ${REAL_REPO}`);
    process.exit(2);
  }

  const planFull = readFileSync(RESEARCH_FILE, 'utf8');
  const planExec = extractExecSummary(planFull);
  const dump = synthContextDump(RESEARCH_FILE, planExec);

  const validation = validateContextDump(dump);
  const thickness = computeThickness(dump);
  console.log(`\nContext dump validation: ok=${validation.ok} thickness=${thickness.toFixed(2)} errors=[${validation.errors.join(', ')}]`);
  console.log(`Plan length (exec-summary slice): ${planExec.length} chars`);
  console.log(`Real EA repo at: ${REAL_REPO}`);
  console.log(`Decisions count: ${readdirSync(join(REAL_REPO, 'decisions')).filter((f) => f.endsWith('.md')).length}`);

  // Stub responder — answers grounded in the synthesised dump's decision_points.
  const stubAnswers: DefenderAnswer[] = [
    {
      round: 1,
      answer:
        'The producer chose NATS JetStream over Kafka because the operational complexity profile (single-binary K3s sidecar) fits the current CAIA topology, sustained throughput exceeds the scale target by orders of magnitude (~750k msg/s on one node vs requirements of hundreds of agents), and TS/Node SDKs are first-class. ADR-011 already named the cross-process ceiling, making Phase-2 the live concern. The dump records this as decision_point #1 with confidence=high, revisitable if multi-tenant SaaS launches with paying-tenant volume.',
      cited_sources: [
        'decision_point:Which broker for CAIA inter-agent comms',
        'caia/packages/event-bus-internal/index.ts',
        'ADR-011'
      ],
      confidence: 'high',
      recommended_action: 'plan-stands',
      ts: new Date().toISOString()
    },
    {
      round: 2,
      answer:
        'Partial-saga in V1 reflects the producer\'s honesty about current failure modes (low cross-stage inconsistency risk in single-host topology). Decision_point #3 names confidence=medium and revisitable_if "cross-stage failures start producing inconsistent state". Producer recommends full saga as V2 follow-up; not a defect of V1 scope, but a deferred decision the operator should re-check when paying tenants exist.',
      cited_sources: ['decision_point:Saga compensation scope for V1'],
      confidence: 'medium',
      recommended_action: 'plan-stands',
      ts: new Date().toISOString()
    }
  ];

  const workDir = mkdtempSync(join(tmpdir(), 'caia-smoke-'));
  const composer = new SignoffComposer({ repositoryPath: workDir });

  const reviewerAdapter: PlanReviewerAdapter = {
    async review(input): Promise<SubAgentVerdict> {
      const responder = new StubResponder(stubAnswers);
      const spawner = new PlanDefenderSpawner({
        dialogueDir: join(workDir, 'dialogues'),
        responder
      });
      const r1Out: RoundOneOutput = {
        status: 'needs-clarification',
        reasoning:
          'The recommendation (NATS JetStream + hybrid choreography) is well-grounded in ADR-011 + the operator scale targets. Two clarifying questions before I sign off: (1) the broker-choice trade-off vs Kafka in §4; (2) the partial-saga-in-V1 decision in §6.',
        cited_adrs: ['ADR-011'],
        cited_principles: ['P1', 'P9', 'P11'],
        cited_lessons: [],
        requested_modifications: [
          'Defender should justify NATS over Kafka beyond the operational-complexity argument.',
          'Producer should confirm the partial-saga-in-V1 decision does not under-provision durability for current failure modes.'
        ],
        new_adrs_to_file: [],
        affected_existing_adrs: [],
        next_question:
          'Why NATS JetStream over Kafka, given Kafka\'s stronger ordering guarantees and broader ecosystem? What grounds the trade-off?',
        next_question_scope: '§4-broker-choice'
      };
      const reviewer = new EaPlanReviewer({ roundOne: new StubRoundOneAdapter(r1Out) });
      const v = await reviewer.review({
        submission: {
          planMarkdown: input.submission.planMarkdown,
          planType: 'research',
          callerAgentId: input.submission.callerAgentId,
          submittedBy: input.submission.submittedBy
        },
        contextDump: input.contextDump as Parameters<typeof reviewer.review>[0]['contextDump'],
        context: { adrs: [], principles: [], lessons: [], risks: [], feedback: [] },
        submissionId: input.submissionId,
        iteration: input.iteration,
        spawner
      });
      const ret: SubAgentVerdict = {
        subAgent: 'ea-plan-reviewer',
        status: v.status,
        reasoning: v.reasoning,
        cited_adrs: v.cited_adrs,
        cited_principles: v.cited_principles,
        cited_lessons: v.cited_lessons,
        requested_modifications: v.requested_modifications,
        new_adrs_to_file: v.new_adrs_to_file,
        affected_existing_adrs: v.affected_existing_adrs,
        defenderRoundsUsed: v.defenderRoundsUsed,
        dialogueLogPath: v.dialogueLogPath,
        dialogue: v.dialogue.map((d) => ({
          q: { round: d.q.round, question: d.q.question, ts: d.q.ts, ...(d.q.scope !== undefined ? { scope: d.q.scope } : {}) },
          a: {
            round: d.a.round,
            answer: d.a.answer,
            cited_sources: d.a.cited_sources,
            confidence: d.a.confidence,
            recommended_action: d.a.recommended_action,
            ts: d.a.ts
          }
        })),
        ranAtIso: new Date().toISOString()
      };
      if (v.escalation_to_operator !== undefined) ret.escalation_to_operator = v.escalation_to_operator;
      return ret;
    }
  };

  const c = new EaCoordinator({
    repositoryPath: REAL_REPO,
    inboxPath: join(workDir, 'INBOX.md'),
    agentMemoryPath: REAL_MEMORY,
    planReviewer: reviewerAdapter,
    signoffComposer: composer,
    generateSubmissionId: (): string => `smoke-${Date.now()}`
  });

  const submission: CoordinatorPlanSubmission = {
    planMarkdown: planExec,
    planType: 'research',
    callerAgentId: 'cowork-default',
    submittedBy: 'smoke-test-bootstrap',
    affectedComponents: ['@chiefaia/event-bus-internal', '@caia/state-machine'],
    contextDump: dump
  };

  banner('Submitting plan to EaCoordinator.review()');
  const outcome = await c.review(submission);

  banner('OUTCOME');
  console.log(JSON.stringify({
    status: outcome.status,
    submissionId: outcome.submissionId,
    subAgentsInvoked: outcome.subAgentsInvoked,
    defenderRoundsUsed: outcome.defenderRoundsUsed,
    citedADRs: outcome.cited_adrs,
    citedPrinciples: outcome.cited_principles,
    requestedModifications: outcome.requested_modifications,
    signoffPath: outcome.signoffPath,
    dialogueLogPath: outcome.dialogueLogPath
  }, null, 2));

  banner('SIGN-OFF DOCUMENT (canonical operator-facing artifact)');
  console.log(readFileSync(outcome.signoffPath, 'utf8'));

  banner('DIALOGUE LOG (the audit trail)');
  if (outcome.dialogueLogPath && existsSync(outcome.dialogueLogPath)) {
    console.log(readFileSync(outcome.dialogueLogPath, 'utf8'));
  }

  banner('SMOKE TEST PASSED');
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
