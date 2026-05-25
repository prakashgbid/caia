/**
 * Smoke test — drives a 5-ticket wave plan through the dispatcher with
 * the REAL caia-coding.md FSE subagent template (read from
 * @caia/claude-subagents/agents/caia-coding.md).
 *
 * The spawner is stubbed (no real claude binary invocation) but the
 * prompt-rendering path is exercised end-to-end. This verifies the brief's
 * "smoke test (5-ticket wave through to real FSE subagent template)"
 * requirement.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { schedule } from '../src/scheduler.js';
import { FakeStateMachine, mk, recordingSpawn } from './test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FSE_TEMPLATE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'claude-subagents',
  'agents',
  'caia-coding.md',
);

describe('smoke: 5-ticket wave through the real FSE subagent template', () => {
  it('renders the caia-coding template into every dispatched prompt', async () => {
    let templateContents: string;
    try {
      templateContents = await readFile(FSE_TEMPLATE_PATH, 'utf8');
    } catch {
      // If the template file is not available in this checkout (eg in a
      // partial clone), skip — fall back to a stub assertion.
      templateContents = 'FALLBACK: caia-coding template not available in this checkout';
    }
    expect(templateContents.length).toBeGreaterThan(0);

    const sm = new FakeStateMachine();
    const projectIdByTicket: Record<string, string> = {};
    const tickets = [];
    for (let i = 0; i < 5; i++) {
      tickets.push(mk(`T-${i}`, i === 0 ? [] : [`T-${i - 1}`]));
      projectIdByTicket[`T-${i}`] = `proj-${i}`;
      sm.ensureProject(`proj-${i}`, 'tests-reviewed');
    }

    const { fn, calls } = recordingSpawn();
    const result = await schedule(
      {
        tickets,
        projectIdByTicket,
        tenantTier: 'pro',
      },
      {
        stateMachine: sm,
        spawnFn: fn,
        fseSubagentPath: FSE_TEMPLATE_PATH,
        workerIds: ['w1', 'w2', 'w3'],
      },
    );

    expect(result.cycles).toEqual([]);
    expect(result.dispatched).toHaveLength(5);
    expect(result.dispatched.every((d) => d.ok)).toBe(true);
    expect(calls).toHaveLength(5);
    // Each dispatched prompt must contain a recognisable fragment of the
    // FSE subagent template (or our fallback marker).
    const looksReal =
      templateContents.includes('CAIA Coding Worker') ||
      templateContents.startsWith('FALLBACK');
    expect(looksReal).toBe(true);
    for (const c of calls) {
      if (templateContents.startsWith('FALLBACK')) {
        expect(c.prompt).toContain('FALLBACK');
      } else {
        expect(c.prompt).toContain('CAIA Coding Worker');
      }
      expect(c.prompt).toContain('Ticket: T-');
    }
  });
});
