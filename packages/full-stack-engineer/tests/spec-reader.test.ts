import { describe, expect, it } from 'vitest';

import {
  SHADCN_STACK_LOCK,
  findStackLockViolations,
  readSpec,
} from '../src/spec-reader.js';
import { makeLoadedTicket, makeTestCase } from './fixtures/ticket-fixture.js';

describe('readSpec', () => {
  it('hydrates the brief id + project + title from the loaded ticket', () => {
    const loaded = makeLoadedTicket({
      ticketId: 'TKT-A',
      projectId: 'proj-X',
      ticket: { id: 'TKT-A', type: 'Story', title: 'Pretty title' },
    });
    const brief = readSpec(loaded);
    expect(brief.ticketId).toBe('TKT-A');
    expect(brief.projectId).toBe('proj-X');
    expect(brief.ticketTitle).toBe('Pretty title');
  });

  it('falls back to displayName then ticketId for the title', () => {
    const a = readSpec(
      makeLoadedTicket({
        ticketId: 'TKT-A',
        ticket: { id: 'TKT-A', type: 'Story', displayName: 'Dn' },
      }),
    );
    expect(a.ticketTitle).toBe('Dn');
    const b = readSpec(
      makeLoadedTicket({ ticketId: 'TKT-B', ticket: { id: 'TKT-B', type: 'Story' } }),
    );
    expect(b.ticketTitle).toBe('TKT-B');
  });

  it('parses the component tree, dropping entries missing path/name', () => {
    const loaded = makeLoadedTicket({
      architecture: {
        frontend: {
          componentTree: [
            { path: 'a.tsx', componentName: 'A', shadcnPrimitives: ['btn'], anchors: ['x'], notes: 'n' },
            { path: '', componentName: 'B' },
            { path: 'c.tsx' },
          ],
        },
      },
    });
    const brief = readSpec(loaded);
    expect(brief.frontend.componentTree).toHaveLength(1);
    expect(brief.frontend.componentTree[0]?.componentName).toBe('A');
  });

  it('preserves design tokens as a record', () => {
    const brief = readSpec(makeLoadedTicket());
    expect(brief.frontend.tokens).toBeDefined();
    expect((brief.frontend.tokens as Record<string, unknown>)['color']).toEqual({ primary: '#000' });
  });

  it('returns undefined tokens when the architect did not emit any', () => {
    const loaded = makeLoadedTicket({ architecture: { frontend: {} } });
    const brief = readSpec(loaded);
    expect(brief.frontend.tokens).toBeUndefined();
  });

  it('parses routes with optional layoutClass and serverComponent', () => {
    const loaded = makeLoadedTicket({
      architecture: {
        frontend: {
          routes: [
            { path: '/r1', rendersComponent: 'C', layoutClass: 'p-4', serverComponent: false },
            { path: '/r2', rendersComponent: 'D' },
          ],
        },
      },
    });
    const brief = readSpec(loaded);
    expect(brief.frontend.routes).toHaveLength(2);
    expect(brief.frontend.routes[0]?.layoutClass).toBe('p-4');
    expect(brief.frontend.routes[0]?.serverComponent).toBe(false);
    expect(brief.frontend.routes[1]?.layoutClass).toBeUndefined();
  });

  it('parses state modules and keeps slice keys in order', () => {
    const brief = readSpec(makeLoadedTicket());
    expect(brief.frontend.stateModules).toHaveLength(1);
    expect(brief.frontend.stateModules[0]?.sliceKeys).toEqual(['user', 'session']);
  });

  it('parses endpoints, normalising method casing, dropping invalid ones', () => {
    const loaded = makeLoadedTicket({
      architecture: {
        backend: {
          endpoints: [
            { method: 'get', path: '/a', handlerPath: 'h.ts', requestShape: 'X', responseShape: 'Y' },
            { method: 'INVALID', path: '/b', handlerPath: 'h.ts' },
            { method: 'POST', path: '', handlerPath: 'h.ts' },
          ],
        },
      },
    });
    const brief = readSpec(loaded);
    expect(brief.backend.endpoints).toHaveLength(1);
    expect(brief.backend.endpoints[0]?.method).toBe('GET');
  });

  it('merges authConstraints from backend and security.authz uniquely', () => {
    const loaded = makeLoadedTicket({
      architecture: {
        backend: { authConstraints: ['a', 'b'] },
        security: { authz: ['b', 'c'] },
      },
    });
    const brief = readSpec(loaded);
    expect(brief.backend.authConstraints).toEqual(['a', 'b', 'c']);
  });

  it('parses migrations and repositories', () => {
    const brief = readSpec(makeLoadedTicket());
    expect(brief.database.migrations[0]?.filename).toBe('20260525_init.sql');
    expect(brief.database.repositories[0]?.repoName).toBe('GreetingsRepo');
  });

  it('parses crosscutting sections', () => {
    const brief = readSpec(makeLoadedTicket());
    expect(brief.crosscutting.accessibility).toEqual(['aria-label on inputs']);
    expect(brief.crosscutting.performanceBudgets).toEqual(['lcp<2.5s']);
    expect(brief.crosscutting.observability).toContain('trace.start("/api/hello")');
    expect(brief.crosscutting.security).toContain('no PII in logs');
    expect(brief.crosscutting.i18n).toContain('locale-en');
    expect(brief.crosscutting.seo[0]).toContain('<title>Hello</title>');
  });

  it('preserves test cases and computes the local gate flags', () => {
    const loaded = makeLoadedTicket({
      testCases: [
        makeTestCase({ id: 'TC-u', title: 'u', layer: 'unit', category: 'happy' }),
        makeTestCase({ id: 'TC-e', title: 'e', layer: 'e2e', category: 'happy' }),
      ],
    });
    const brief = readSpec(loaded);
    expect(brief.tests.cases.map((c) => c.id)).toEqual(['TC-u', 'TC-e']);
    expect(brief.tests.localGate.vitest).toBe(true);
  });

  it('disables the vitest local gate when no unit/integration cases exist', () => {
    const loaded = makeLoadedTicket({
      testCases: [
        makeTestCase({ id: 'TC-e', title: 'e', layer: 'e2e', category: 'happy' }),
      ],
    });
    const brief = readSpec(loaded);
    expect(brief.tests.localGate.vitest).toBe(false);
  });

  it('collects miscArchitectNotes from architectOutputs[].notes', () => {
    const loaded = makeLoadedTicket({
      architectOutputs: [
        {
          architectName: 'analytics',
          architectureFields: {},
          confidence: 1,
          notes: 'consider funnel events',
          dependencies: [],
          risks: [],
          toolCalls: [],
          spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'test' },
          status: 'ok',
        },
        {
          architectName: 'silent',
          architectureFields: {},
          confidence: 1,
          notes: '',
          dependencies: [],
          risks: [],
          toolCalls: [],
          spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'test' },
          status: 'ok',
        },
      ],
    });
    const brief = readSpec(loaded);
    expect(brief.miscArchitectNotes).toEqual([
      { architect: 'analytics', note: 'consider funnel events' },
    ]);
  });

  it('emits the SHADCN_STACK_LOCK on every brief', () => {
    const brief = readSpec(makeLoadedTicket());
    expect(brief.stackLock).toEqual(SHADCN_STACK_LOCK);
    expect(brief.stackLock.shadcnReactFirst).toBe(true);
    expect(brief.stackLock.uiPrimitives).toBe('shadcn/ui');
    expect(brief.stackLock.styling).toBe('tailwind');
  });

  it('survives a ticket with totally missing architecture blob', () => {
    const loaded = makeLoadedTicket({ architecture: {} });
    const brief = readSpec(loaded);
    expect(brief.frontend.componentTree).toEqual([]);
    expect(brief.backend.endpoints).toEqual([]);
    expect(brief.database.migrations).toEqual([]);
  });
});

describe('findStackLockViolations', () => {
  it('returns empty when no forbidden imports are present', () => {
    expect(
      findStackLockViolations([
        { path: 'a.tsx', contents: `import { Button } from '@/components/ui/button';` },
      ]),
    ).toEqual([]);
  });

  it('flags a forbidden import from @mui/material', () => {
    const violations = findStackLockViolations([
      { path: 'a.tsx', contents: `import { Button } from '@mui/material';` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe('a.tsx');
    expect(violations[0]?.violation).toContain('@mui/*');
  });

  it('flags styled-components and @emotion', () => {
    const violations = findStackLockViolations([
      { path: 'sc.tsx', contents: `import styled from 'styled-components';` },
      { path: 'em.tsx', contents: `import { css } from '@emotion/react';` },
    ]);
    expect(violations.map((v) => v.path).sort()).toEqual(['em.tsx', 'sc.tsx']);
  });

  it('skips non-frontend file extensions', () => {
    expect(
      findStackLockViolations([
        { path: 'a.sql', contents: `import x from 'styled-components';` },
      ]),
    ).toEqual([]);
  });

  it('skips test files (they may import @testing-library/etc.)', () => {
    expect(
      findStackLockViolations([
        { path: 'a.test.tsx', contents: `import x from '@mui/material';` },
      ]),
    ).toEqual([]);
  });
});
