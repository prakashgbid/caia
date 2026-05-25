/**
 * Deterministic fixture builders for full-stack-engineer tests.
 */

import type { TestCase } from '@chiefaia/ticket-template';

import type {
  EmittedFile,
  GitAdapter,
  LoadedTicket,
  LocalGateResult,
  LocalGateRunner,
  TicketStore,
} from '../../src/types.js';

let designCounter = 0;

export function makeTestCase(overrides: Partial<TestCase> & Pick<TestCase, 'id' | 'title' | 'layer' | 'category'>): TestCase {
  return {
    id: overrides.id,
    title: overrides.title,
    layer: overrides.layer,
    category: overrides.category,
    given: overrides.given ?? `given for ${overrides.id}`,
    when: overrides.when ?? `when for ${overrides.id}`,
    then: overrides.then ?? `then for ${overrides.id}`,
    selectorHints: overrides.selectorHints ?? [],
    mocks: overrides.mocks ?? [],
    required: overrides.required ?? true,
    status: overrides.status ?? 'pending',
    designedBy: overrides.designedBy ?? 'testing-agent',
    designedAt: overrides.designedAt ?? ++designCounter,
    ...(overrides.linkedAcceptanceCriterionIndex !== undefined
      ? { linkedAcceptanceCriterionIndex: overrides.linkedAcceptanceCriterionIndex }
      : {}),
  } as TestCase;
}

export function makeLoadedTicket(overrides: Partial<LoadedTicket> = {}): LoadedTicket {
  const ticketId = overrides.ticketId ?? 'TKT-DEFAULT';
  const projectId = overrides.projectId ?? 'proj-default';
  return {
    ticketId,
    projectId,
    repoPath: overrides.repoPath ?? '/tmp/test-repo',
    branchName: overrides.branchName ?? `feat/${ticketId.toLowerCase()}`,
    commitScope: overrides.commitScope ?? 'feat(test)',
    ticket: overrides.ticket ?? {
      id: ticketId,
      type: 'Story',
      title: 'Test ticket',
    },
    architecture: overrides.architecture ?? defaultArchitecture(),
    acceptanceCriteria:
      overrides.acceptanceCriteria ?? ['Renders the page', 'Submits the form'],
    testCases:
      overrides.testCases ?? [
        makeTestCase({ id: 'TC-1', title: 'happy', layer: 'unit', category: 'happy' }),
      ],
    ...(overrides.architectOutputs !== undefined
      ? { architectOutputs: overrides.architectOutputs }
      : {}),
    ...(overrides.fileAllowlist !== undefined
      ? { fileAllowlist: overrides.fileAllowlist }
      : {}),
  };
}

export function defaultArchitecture(): Record<string, unknown> {
  return {
    frontend: {
      componentTree: [
        {
          path: 'src/components/Hello.tsx',
          componentName: 'Hello',
          shadcnPrimitives: ['button', 'card'],
          anchors: ['hero'],
          notes: 'Greets the user',
        },
      ],
      routes: [
        {
          path: 'app/page.tsx',
          rendersComponent: 'src/components/Hello.tsx',
          serverComponent: true,
          layoutClass: 'container mx-auto p-4',
        },
      ],
      stateModules: [
        {
          path: 'src/state/user.ts',
          storeName: 'UserStore',
          sliceKeys: ['user', 'session'],
        },
      ],
      tokens: { color: { primary: '#000' } },
    },
    backend: {
      endpoints: [
        {
          method: 'POST',
          path: '/api/hello',
          handlerPath: 'src/api/hello.ts',
          requestShape: '{ name: string }',
          responseShape: '{ greeting: string }',
          notes: 'Returns greeting',
        },
      ],
      services: [
        {
          path: 'src/services/greeter.ts',
          serviceName: 'GreeterService',
          notes: 'Builds greetings',
        },
      ],
      authConstraints: ['anonymous-ok'],
    },
    database: {
      migrations: [
        {
          filename: '20260525_init.sql',
          sql: 'CREATE TABLE greetings (id SERIAL PRIMARY KEY);',
          notes: 'init',
        },
      ],
      repositories: [
        {
          path: 'src/repos/greetings.ts',
          repoName: 'GreetingsRepo',
          notes: 'select/insert',
        },
      ],
    },
    accessibility: { constraints: ['aria-label on inputs'] },
    performance: { budgets: ['lcp<2.5s'] },
    observability: { hooks: ['trace.start("/api/hello")'] },
    security: { constraints: ['no PII in logs'], authz: ['session.read'] },
    i18n: { constraints: ['locale-en'] },
    seo: { constraints: ['<title>Hello</title>'] },
  };
}

export function staticStore(ticket: LoadedTicket): TicketStore {
  return {
    async loadTicket(): Promise<LoadedTicket> {
      return ticket;
    },
  };
}

export interface StubGitState {
  committed: Array<{ branchName: string; message: string; files: readonly EmittedFile[] }>;
  pushed: string[];
  prs: Array<{ prNumber: number; prUrl: string; branchName: string; title: string; body: string; base: string }>;
  nextPrNumber: number;
}

export function newStubGitState(): StubGitState {
  return { committed: [], pushed: [], prs: [], nextPrNumber: 100 };
}

export function stubGit(state: StubGitState = newStubGitState(), overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    async stageAndCommit(input) {
      state.committed.push({
        branchName: input.branchName,
        message: input.message,
        files: input.files,
      });
      return { commitSha: `sha-${state.committed.length}` };
    },
    async push(input) {
      state.pushed.push(input.branchName);
    },
    async openPr(input) {
      const prNumber = state.nextPrNumber++;
      const pr = {
        prNumber,
        prUrl: `https://github.com/example/repo/pull/${prNumber}`,
        branchName: input.branchName,
        title: input.title,
        body: input.body,
        base: input.base,
      };
      state.prs.push(pr);
      return { prNumber: pr.prNumber, prUrl: pr.prUrl };
    },
    async prExists(input) {
      const existing = state.prs.find((p) => p.branchName === input.branchName);
      if (!existing) return null;
      return { prNumber: existing.prNumber, prUrl: existing.prUrl };
    },
    ...overrides,
  };
}

export function stubLocalGate(result: { passed: boolean; output?: string } = { passed: true }): LocalGateRunner {
  const make = (): LocalGateResult => ({
    passed: result.passed,
    durationMs: 1,
    output: result.output ?? '',
  });
  return {
    async typecheck() {
      return make();
    },
    async lint() {
      return make();
    },
    async vitest() {
      return make();
    },
  };
}
