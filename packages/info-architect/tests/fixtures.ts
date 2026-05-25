/**
 * Shared test fixtures.
 *
 * Builds the canonical IaInput + a stub FSM adapter + memory persistence
 * so test files don't repeat the boilerplate.
 */

import type { ProjectState } from '@caia/state-machine';

import { InfoArchitectError } from '../src/errors.js';
import { IaMemoryPersistence } from '../src/persistence.js';
import type {
  FsmTransition,
  IaInput,
  IaStateMachineAdapter,
} from '../src/types.js';

export function buildIaInput(overrides: Partial<IaInput> = {}): IaInput {
  return {
    projectId: '11111111-1111-1111-1111-111111111111',
    tenantContext: {
      tenantId: '22222222-2222-2222-2222-222222222222',
      tenantSlug: 'prakash-tiwari',
      tenantName: 'Prakash Tiwari',
      enterpriseTier: false,
    },
    businessPlan: {
      revisionId: 'bp-v2-001',
      completenessScore: 92,
      brandVoiceDesign:
        'Confident, technical, calm. Graphite-and-warm palette. Sans-serif body.',
      valueProposition:
        'A founder portfolio site that demonstrates technical leadership and shipping discipline.',
      targetUser:
        'Hiring managers at series-B/C startups looking for a fractional CTO.',
      horizonHints: {
        mvp: ['Hero', 'Work', 'Contact'],
        oneYear: ['Blog', 'Speaking', 'Case studies'],
      },
    },
    projectType: 'client',
    ...overrides,
  };
}

export interface StubFsmOptions {
  initialState?: ProjectState;
  throwOnTransition?: boolean;
  throwOnRead?: boolean;
}

export class StubFsm implements IaStateMachineAdapter {
  public state: ProjectState;
  public readonly transitions: FsmTransition[] = [];
  public readonly throwOnTransition: boolean;
  public readonly throwOnRead: boolean;

  public constructor(opts: StubFsmOptions = {}) {
    this.state = opts.initialState ?? 'interview-complete';
    this.throwOnTransition = opts.throwOnTransition ?? false;
    this.throwOnRead = opts.throwOnRead ?? false;
  }

  public async currentState(_projectId: string): Promise<ProjectState> {
    void _projectId;
    if (this.throwOnRead) throw new Error('stub: currentState forced to throw');
    return this.state;
  }

  public async transition(
    _projectId: string,
    to: ProjectState,
    _payload: {
      reason: string;
      triggeredById: string;
      payload?: Readonly<Record<string, unknown>>;
    },
  ): Promise<FsmTransition> {
    void _projectId;
    void _payload;
    if (this.throwOnTransition) {
      throw new InfoArchitectError(
        'fsm_transition_failed',
        'stub: transition forced to throw',
      );
    }
    const from = this.state;
    this.state = to;
    const t = { from, to };
    this.transitions.push(t);
    return t;
  }
}

export function buildMemoryPersistence(input?: IaInput): {
  persistence: IaMemoryPersistence;
  input: IaInput;
} {
  const iaInput = input ?? buildIaInput();
  const persistence = new IaMemoryPersistence({
    inputs: [[iaInput.projectId, iaInput]],
    clock: (): Date => new Date('2026-05-25T12:00:00.000Z'),
  });
  return { persistence, input: iaInput };
}
