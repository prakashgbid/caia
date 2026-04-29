/**
 * Per-agent regression — Coding Agent (ImplementationEngine).
 *
 * Asserts the Coding Agent's runtime contract:
 *   - System prompt references the bundle's story, acceptance
 *     criteria, agent sections, and test cases.
 *   - implement() loops until the LlmAdapter emits DONE_MARKER.
 *   - implement() returns 'turn-limit' when the adapter never emits
 *     DONE_MARKER.
 *   - applyFix() resumes the same session and stops on
 *     FIX_APPLIED <sha>.
 *   - Total tokens are accumulated across turns.
 */

import {
  ImplementationEngine,
  MockLlmAdapter,
  DONE_MARKER,
  FIX_APPLIED_MARKER_PREFIX,
} from '../../../../worker-coding/src/implementation-engine';
import type { Bundle } from '../../../../worker-coding/src/bundle-reader';
import type { Worktree } from '../../../../worker-coding/src/worktree-manager';
import { makeFakeWorktree } from '../_helpers/worktree';

const FAKE_BUNDLE: Bundle = {
  story: {
    id: 'story_coding_regression',
    title: 'add a contact form',
    description: 'a small form',
    status: 'open',
    rootPromptId: 'prm_coding',
    parentEntityId: null,
    parentEntityType: null,
    bucketId: 'bkt_par_prm_coding',
    templateVersion: 'v1',
    templateValidationStatus: 'valid',
    templateValidationErrors: null,
    enrichedAt: null,
    updatedAt: null,
  },
  ticket: {
    acceptanceCriteria: ['user fills the form', 'submission persists', 'confirmation shows'],
    scope: { summary: 'contact form' },
    agentSections: {
      ui: { framework: 'react' },
      api: { route: 'POST /api/contact' },
    },
    testCases: [
      { id: 'tc-1', title: 'happy', category: 'happy' },
    ],
    architecturalInstructions: [
      { kind: 'reuse', domain: 'frontend', text: 'use the existing FormShell' },
    ],
    claims: { files: [], schemas: [], apiRoutes: ['POST /api/contact'], domains: ['frontend', 'bff'] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  ticketParseError: null,
  prompt: {
    id: 'prm_coding',
    body: 'add a contact form',
    receivedAt: '2026-04-29T00:00:00Z',
    correlationId: 'prm_coding',
    status: 'ready_for_pickup',
  },
  requirement: null,
  bucket: {
    id: 'bkt_par_prm_coding',
    kind: 'parallel',
    domainSlug: null,
    sequenceIndex: null,
    status: 'open',
  },
  labels: [],
  dependencies: { upstream: [], downstream: [] },
  inputDependencies: [],
};

describe('Per-agent regression — Coding Agent', () => {
  it('builds a system prompt referencing the story, AC, sections, test cases', () => {
    const { worktree, cleanup } = makeFakeWorktree('story_coding_regression');
    try {
      const adapter = new MockLlmAdapter();
      const engine = new ImplementationEngine({ bundle: FAKE_BUNDLE, worktree, adapter });
      const sys = engine.buildSystemPrompt();
      expect(sys).toContain('story_coding_regression');
      expect(sys).toContain('ACCEPTANCE CRITERIA');
      expect(sys).toContain('TEST CASES');
      expect(sys).toContain('use the existing FormShell');
      expect(sys).toContain('frontend');
    } finally {
      cleanup();
    }
  });

  it('implement() exits on DONE_MARKER on turn 1', async () => {
    const { worktree, cleanup } = makeFakeWorktree('story_coding_done');
    try {
      const adapter = new MockLlmAdapter();
      adapter.enqueue({
        text: `Implementation complete.\n${DONE_MARKER}\n`,
        done: true,
        tokens: { input: 10, output: 5 },
      });
      const engine = new ImplementationEngine({ bundle: FAKE_BUNDLE, worktree, adapter });
      await engine.start();
      const r = await engine.implement();
      expect(r.status).toBe('done');
      expect(r.turns).toBe(1);
      expect(r.totalTokens).toEqual({ input: 10, output: 5 });
      await engine.end();
    } finally {
      cleanup();
    }
  });

  it('implement() returns turn-limit when DONE_MARKER never arrives', async () => {
    const { worktree, cleanup } = makeFakeWorktree('story_coding_turnlimit');
    try {
      const adapter = new MockLlmAdapter();
      // Enqueue 3 turns without DONE_MARKER.
      for (let i = 0; i < 3; i++) {
        adapter.enqueue({ text: 'still working', done: false, tokens: { input: 5, output: 5 } });
      }
      const engine = new ImplementationEngine({
        bundle: FAKE_BUNDLE,
        worktree,
        adapter,
        maxImplementTurns: 3,
      });
      await engine.start();
      const r = await engine.implement();
      expect(r.status).toBe('turn-limit');
      expect(r.turns).toBe(3);
      await engine.end();
    } finally {
      cleanup();
    }
  });

  it('applyFix() resumes the session and stops on FIX_APPLIED', async () => {
    const { worktree, cleanup } = makeFakeWorktree('story_coding_fix');
    try {
      const adapter = new MockLlmAdapter();
      adapter.enqueue({
        text: `${FIX_APPLIED_MARKER_PREFIX} a1b2c3d`,
        done: false,
        fixApplied: true,
        fixSha: 'a1b2c3d',
        tokens: { input: 5, output: 3 },
      });
      const engine = new ImplementationEngine({ bundle: FAKE_BUNDLE, worktree, adapter });
      await engine.start();
      const r = await engine.applyFix({
        testCaseId: 'tc-1',
        whatFailed: 'snapshot mismatch',
        hypothesis: 'wrong className',
      });
      expect(r.status).toBe('fix-applied');
      expect(r.sha).toBe('a1b2c3d');
      await engine.end();
    } finally {
      cleanup();
    }
  });
});
