import { describe, expect, it } from 'vitest';

import {
  FULL_STACK_ENGINEER_SYSTEM_PROMPT,
  buildEngineerPrompt,
} from '../src/agent.js';
import { readSpec } from '../src/spec-reader.js';
import { makeLoadedTicket, makeTestCase } from './fixtures/ticket-fixture.js';

describe('FULL_STACK_ENGINEER_SYSTEM_PROMPT', () => {
  it('frames the worker as a senior full-stack engineer', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('senior full-stack engineer');
  });

  it('declares the shadcn/ui + Tailwind stack lock as non-negotiable', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('shadcn/ui');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('Tailwind');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('NO CSS-in-JS');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('NO MUI');
  });

  it('declares ZERO deviation from acceptance criteria', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toMatch(/ZERO deviation from acceptance criteria/i);
  });

  it('declares the Test Author cases as LAW', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toMatch(/Test Author Agent are LAW/);
  });

  it('encodes the stop markers', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('[result] DONE');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('[result] FAILED');
  });

  it('declares conventional commits ONLY', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('Conventional commits ONLY');
  });

  it('declares subscription-only', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('Subscription-only');
  });

  it('declares the JSON file-plan output shape', () => {
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('"frontend"');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('"backend"');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('"database"');
    expect(FULL_STACK_ENGINEER_SYSTEM_PROMPT).toContain('"tests"');
  });
});

describe('buildEngineerPrompt', () => {
  it('renders the ticket id and title in the header', () => {
    const loaded = makeLoadedTicket({
      ticketId: 'TKT-77',
      ticket: { id: 'TKT-77', type: 'Story', title: 'Checkout page' },
    });
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('# Ticket TKT-77 — Checkout page');
    expect(prompt).toContain('Project: `proj-default`');
  });

  it('lists acceptance criteria as bullets', () => {
    const loaded = makeLoadedTicket({
      acceptanceCriteria: ['User can submit', 'User sees confirmation'],
    });
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('- User can submit');
    expect(prompt).toContain('- User sees confirmation');
  });

  it('surfaces the stack-lock block verbatim', () => {
    const loaded = makeLoadedTicket();
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('UI primitives: shadcn/ui');
    expect(prompt).toContain('Styling: tailwind');
    expect(prompt).toContain('shadcn-react-first locked: true');
    expect(prompt).toContain('`@mui/*`');
    expect(prompt).toContain('`styled-components`');
  });

  it('renders the component tree with shadcn primitives and anchors', () => {
    const loaded = makeLoadedTicket();
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('- `src/components/Hello.tsx` — `Hello`');
    expect(prompt).toContain('shadcn primitives: `button`, `card`');
    expect(prompt).toContain('anchors: `hero`');
  });

  it('renders endpoints with method, path, handler, and shapes', () => {
    const loaded = makeLoadedTicket();
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('- `POST /api/hello` → `src/api/hello.ts`');
    expect(prompt).toContain('request: `{ name: string }`');
    expect(prompt).toContain('response: `{ greeting: string }`');
  });

  it('renders migrations inside fenced SQL code blocks', () => {
    const loaded = makeLoadedTicket();
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('- `20260525_init.sql`');
    expect(prompt).toContain('```sql');
    expect(prompt).toContain('CREATE TABLE greetings');
  });

  it('renders test cases as LAW with selectors when present', () => {
    const loaded = makeLoadedTicket({
      testCases: [
        makeTestCase({
          id: 'TC-9',
          title: 'submit',
          layer: 'e2e',
          category: 'happy',
          selectorHints: ['[data-test="submit"]', 'button.submit'],
        }),
      ],
    });
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).toContain('Test cases (LAW');
    expect(prompt).toContain('- `TC-9` [e2e/happy] — submit');
    expect(prompt).toContain('selectors: `[data-test="submit"]`, `button.submit`');
  });

  it('omits empty crosscutting section when no items are present', () => {
    const loaded = makeLoadedTicket({
      architecture: {
        frontend: { componentTree: [], routes: [], stateModules: [] },
        backend: { endpoints: [], services: [], authConstraints: [] },
        database: { migrations: [], repositories: [] },
      },
    });
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt).not.toContain('## Crosscutting');
  });

  it('ends with the JSON file plan stop instruction', () => {
    const loaded = makeLoadedTicket();
    const brief = readSpec(loaded);
    const prompt = buildEngineerPrompt(brief);
    expect(prompt.trim().endsWith('Emit the JSON file plan now, then stop with `[result] DONE: …` or `[result] FAILED: …`.')).toBe(true);
  });
});
