/**
 * Normaliser — RawArtifact[] → InstructionPair[].
 *
 * Per the DESIGN.md table, source+kind picks an instruction template
 * and a response-extraction strategy. Output is one or more
 * InstructionPair per artifact (most artifacts produce exactly one).
 *
 * Stable id is sha256 of `messages` content joined by `\n` — used as
 * primary key in dedupe and as `meta.contentSha256`.
 */

import { createHash } from 'node:crypto';

import { CAIA_SYSTEM_PROMPT } from './system-prompt.js';
import type {
  ChatMessage,
  InstructionPair,
  RawArtifact,
  SourceTag
} from './types.js';

/** Build the user-side instruction text for a given artifact. */
export function instructionFor(a: RawArtifact): string | null {
  switch (a.source) {
    case 'memory':
      return memoryInstruction(a.kind);
    case 'reports':
      return 'Summarize this report and explain its purpose.';
    case 'events':
      return eventInstruction(a.kind);
    case 'github':
      return 'What was the goal of this PR and how was it accomplished?';
    case 'langfuse':
      return 'Given this prior trace input, produce an equivalent response.';
    default:
      return null;
  }
}

function memoryInstruction(kind: string | undefined): string {
  switch (kind) {
    case 'directive':
      return 'Summarize the standing rule or directive in this document.';
    case 'feedback':
      return 'What does this feedback say to do or avoid, and why?';
    case 'architecture':
      return 'Explain the architectural decision in this document.';
    case 'registry':
      return 'Describe what this registry catalogs and how it is used.';
    case 'master':
      return 'Summarize the master plan or sequencing in this document.';
    case 'landscape':
      return 'Summarize the ecosystem research in this document.';
    case 'gate':
      return 'Explain the gate or evidence rule in this document.';
    case 'safety':
      return 'Explain the safety or hardening rule in this document.';
    case 'team':
      return 'Describe the team or agent architecture in this document.';
    case 'phase':
      return 'Summarize the phase plan described here.';
    case 'backlog':
      return 'Describe the backlog item captured in this document.';
    case 'proposal':
      return 'What does this proposal recommend, and why?';
    case 'consolidation':
      return 'Summarize the consolidation actions in this document.';
    case 'daemon':
      return 'Describe the daemon configuration in this document.';
    case 'cci':
      return 'Describe the CCI worker configuration in this document.';
    case 'mac':
      return 'Describe the Mac dev landscape note in this document.';
    case 'mcp':
      return 'Describe the MCP server configuration in this document.';
    default:
      return 'Summarize this memory document.';
  }
}

function eventInstruction(kind: string | undefined): string {
  switch (kind) {
    case 'PRMerged':
      return 'A PR was merged. What was its purpose and outcome?';
    case 'PRClosedWithoutMerge':
      return 'A PR was closed without merging. Why was it abandoned?';
    case 'PostMergeBugReport':
      return 'A regression was reported post-merge. What was the issue and what should be learned?';
    case 'OperatorCorrection':
      return 'An operator correction was issued. What was wrong and what is the corrected approach?';
    case 'OperatorAcknowledged':
      return 'The operator acknowledged a finding. What was confirmed?';
    case 'EvidenceGateFailure':
      return 'An Evidence Gate check failed. What was the failure and how can it be avoided?';
    case 'HallucinationFlagged':
      return 'A hallucination was flagged. What was the hallucination and what is the truth?';
    case 'ScopeMismatchFlagged':
      return 'A scope mismatch was flagged. What was out of scope?';
    case 'DoDViolation':
      return 'A Definition-of-Done violation was flagged. What stage was skipped?';
    case 'TaskFailed':
      return 'A task failed. What was the error and the recovery action?';
    case 'TaskAborted':
      return 'A task was aborted. What was the reason?';
    case 'DecisionClassifierTrip':
      return 'The decision classifier was tripped. What kind of decision was misrouted?';
    case 'ToolMisuseFlagged':
      return 'Tool misuse was flagged. What was the misuse?';
    case 'CapabilityBrokerOverride':
      return 'A capability broker override fired. What capability was gated and why?';
    default:
      return `An event of type "${kind ?? 'unknown'}" was emitted. What does it record?`;
  }
}

/** Strip noise + cap length on the response text. */
export function buildResponse(a: RawArtifact, maxChars: number): string {
  let body = (a.text ?? '').trim();
  if (body.length > maxChars) {
    // Truncate at last paragraph break before cap, falling back to hard cut
    const cap = body.slice(0, maxChars);
    const lastBreak = cap.lastIndexOf('\n\n');
    body = lastBreak > maxChars * 0.5 ? cap.slice(0, lastBreak) : cap;
  }
  return body;
}

export interface NormaliserOptions {
  minSampleLengthChars: number;
  maxSampleLengthChars: number;
  systemPrompt?: string;
  /** Now-getter for stable createdAt timestamps in tests. */
  clock: () => Date;
}

/**
 * Normalise a single artifact. Returns null when the artifact is too
 * short or when no instruction template applies; the caller records
 * the drop reason.
 */
export function normaliseOne(a: RawArtifact, opts: NormaliserOptions): InstructionPair | null {
  const instruction = instructionFor(a);
  if (instruction === null) return null;
  const response = buildResponse(a, opts.maxSampleLengthChars);
  if (response.length < opts.minSampleLengthChars) return null;

  const sysPrompt = opts.systemPrompt ?? CAIA_SYSTEM_PROMPT;
  const messages: ChatMessage[] = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: instruction },
    { role: 'assistant', content: response }
  ];
  const sha = sha256OfMessages(messages);
  const pair: InstructionPair = {
    id: sha,
    messages,
    meta: {
      source: a.source,
      sourceId: a.sourceId,
      ...(a.correlationId !== undefined ? { correlationId: a.correlationId } : {}),
      ...(a.kind !== undefined ? { kind: a.kind } : {}),
      qualityScore: 0, // filled in by quality.ts
      distilled: false,
      redactedSpans: [],
      createdAt: opts.clock().toISOString(),
      contentSha256: sha
    }
  };
  return pair;
}

/** Normalise an array. Drops failures silently — caller is the
 *  aggregator which records the drop reason from a separate pass. */
export function normaliseAll(
  artifacts: ReadonlyArray<RawArtifact>,
  opts: NormaliserOptions
): { kept: InstructionPair[]; droppedSourceIds: Array<{ id: string; source: SourceTag; reason: 'too-short' | 'no-instruction-extractable' }> } {
  const kept: InstructionPair[] = [];
  const dropped: Array<{ id: string; source: SourceTag; reason: 'too-short' | 'no-instruction-extractable' }> = [];
  for (const a of artifacts) {
    const instruction = instructionFor(a);
    if (instruction === null) {
      dropped.push({ id: a.sourceId, source: a.source, reason: 'no-instruction-extractable' });
      continue;
    }
    const response = buildResponse(a, opts.maxSampleLengthChars);
    if (response.length < opts.minSampleLengthChars) {
      dropped.push({ id: a.sourceId, source: a.source, reason: 'too-short' });
      continue;
    }
    const pair = normaliseOne(a, opts);
    if (pair !== null) kept.push(pair);
  }
  return { kept, droppedSourceIds: dropped };
}

export function sha256OfMessages(messages: ChatMessage[]): string {
  const joined = messages.map((m) => `${m.role}\n${m.content}`).join('\n---\n');
  return createHash('sha256').update(joined, 'utf-8').digest('hex');
}
