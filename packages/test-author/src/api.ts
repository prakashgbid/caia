/**
 * `authorTests` — orchestrator entrypoint. Loads the ticket + composed
 * architecture, invokes the agent, persists the output, and emits the
 * canonical state-machine transitions.
 *
 * Pass path: one transition (`ea-complete → tests-authored`).
 * Fail path: two transitions (`ea-complete → tests-authored` with
 * `intermediate: true`, then `tests-authored → tests-authoring-failed`).
 * Mirrors `@caia/test-reviewer`'s api.ts chain pattern verbatim.
 */

import type { ProjectState } from '@caia/state-machine';

import {
  AUTHOR_AGENT_ID,
  AUTHOR_FAIL_INTERMEDIATE_STATE,
  AUTHOR_FAIL_STATE,
  AUTHOR_PASS_STATE,
  AUTHOR_PRE_STATE
} from './contract.js';
import { TestAuthorAgent, type TestAuthorAgentConfig } from './agent.js';
import { persistAuthorOutput } from './persistence.js';
import type {
  ArchitectureStore,
  AuthorBudget,
  AuthorInput,
  AuthorOutcome,
  AuthorOutput,
  StateMachineAdapter,
  TicketStore
} from './types.js';

export interface AuthorTestsConfig {
  store: TicketStore;
  architectureStore?: ArchitectureStore;
  stateMachine?: StateMachineAdapter;
  agent?: TestAuthorAgent;
  agentConfig?: TestAuthorAgentConfig;
  budget?: AuthorBudget;
  skipStateMachine?: boolean;
}

interface TransitionRow {
  from: ProjectState;
  to: ProjectState;
  intermediate: boolean;
}

export async function authorTests(
  ticketId: string,
  config: AuthorTestsConfig
): Promise<AuthorOutcome> {
  const ticket = await config.store.loadTicket(ticketId);
  if (!ticket) {
    throw new Error(`ticket ${ticketId} not found`);
  }
  const composedArchitecture = config.architectureStore
    ? await config.architectureStore.loadArchitecture(ticketId)
    : ((ticket.architecture as Record<string, unknown> | undefined) ?? {});

  const agent = config.agent ?? new TestAuthorAgent(config.agentConfig);

  const designInput: AuthorInput = {
    ticket,
    composedArchitecture,
    ...(ticket.acceptance_criteria !== undefined
      ? { acceptanceCriteria: ticket.acceptance_criteria }
      : {}),
    ...(config.budget !== undefined ? { budget: config.budget } : {})
  };
  const output: AuthorOutput = await agent.design(designInput);

  const persistResult = await persistAuthorOutput({
    ticketId,
    output,
    store: config.store
  });

  const emitted: TransitionRow[] = [];
  if (config.stateMachine && !config.skipStateMachine) {
    const isPass = output.status === 'ok' && persistResult.written;
    if (isPass) {
      await config.stateMachine.transition({
        ticketId,
        from: AUTHOR_PRE_STATE,
        to: AUTHOR_PASS_STATE,
        triggeredBy: { kind: 'agent', id: AUTHOR_AGENT_ID },
        payload: {
          decision: 'pass',
          summary: output.notes,
          testDesign: output.testDesign
        }
      });
      emitted.push({
        from: AUTHOR_PRE_STATE,
        to: AUTHOR_PASS_STATE,
        intermediate: false
      });
    } else {
      const failureReason = output.failureReason ?? persistResult.reason ?? 'unknown';
      await config.stateMachine.transition({
        ticketId,
        from: AUTHOR_PRE_STATE,
        to: AUTHOR_FAIL_INTERMEDIATE_STATE,
        triggeredBy: { kind: 'agent', id: AUTHOR_AGENT_ID },
        payload: {
          intermediate: true,
          decision: 'fail',
          failureReason,
          summary: output.notes
        }
      });
      emitted.push({
        from: AUTHOR_PRE_STATE,
        to: AUTHOR_FAIL_INTERMEDIATE_STATE,
        intermediate: true
      });

      await config.stateMachine.transition({
        ticketId,
        from: AUTHOR_FAIL_INTERMEDIATE_STATE,
        to: AUTHOR_FAIL_STATE,
        triggeredBy: { kind: 'agent', id: AUTHOR_AGENT_ID },
        payload: {
          decision: 'fail',
          failureReason,
          summary: output.notes
        }
      });
      emitted.push({
        from: AUTHOR_FAIL_INTERMEDIATE_STATE,
        to: AUTHOR_FAIL_STATE,
        intermediate: false
      });
    }
  }

  return {
    ticketId,
    output,
    emittedTransitions: emitted
  };
}
