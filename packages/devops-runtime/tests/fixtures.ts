/**
 * Test fixtures + adapters shared across all test files.
 */

import type {
  ArchitectureDevopsSlice,
  ByocAdapter,
  CapabilityIssuer,
  DeployAdapterInput,
  DeployAdapterOutput,
  HealthcheckSnapshot,
  LoadedDeployTicket,
  SnapshotRestoreInput,
  TicketStore,
} from '../src/types.js';

export function devopsSlice(overrides: Partial<ArchitectureDevopsSlice> = {}): ArchitectureDevopsSlice {
  return {
    deployStrategy: {
      strategy: 'canary',
      trafficShiftSchedule: [10, 50, 100],
      dwellMin: 5,
      healthcheckPath: '/_health',
      abortCondition: { healthcheckRedSecs: 30 },
    },
    rollbackContract: {
      trigger: 'healthcheck-failure',
      autoRevertWindowMin: 5,
      method: 'git-revert-and-redeploy',
      dataMigrationRollback: 'reversible',
    },
    infrastructureAsCode: {
      tool: 'terraform',
      capabilities: ['traffic-split', 'two-identical-environments', 'multi-instance'],
    },
    environmentPromotion: {
      environments: [
        { name: 'development', autoPromote: true },
        { name: 'staging', autoPromote: true },
        { name: 'production', autoPromote: false, gateKind: 'manual-operator' },
      ],
    },
    deploymentObservability: {
      eventTypes: [
        'deploy.started',
        'deploy.succeeded',
        'deploy.failed',
        'deploy.rollback.triggered',
        'deploy.healthcheck.failed',
      ],
      retentionDays: 365,
    },
    secretsManagementInPipeline: {
      provider: 'vault-via-security-architect',
      tokenLifetimeMin: 30,
    },
    ...overrides,
  };
}

export function loadedTicket(
  overrides: Partial<LoadedDeployTicket> = {},
): LoadedDeployTicket {
  return {
    ticketId: 'TKT-001',
    solutionId: 'caia-2026-05-25-deploy-test',
    gitSha: 'abc1234',
    architecture: { devops: devopsSlice() },
    repoPath: '/tmp/fake-repo',
    tenantId: 'tenant-a',
    ...overrides,
  };
}

export function ticketStore(loaded: LoadedDeployTicket = loadedTicket()): TicketStore {
  return {
    loadTicket: async (_id: string) => loaded,
  };
}

export function failingTicketStore(message = 'load failed'): TicketStore {
  return {
    loadTicket: async (_id: string) => {
      throw new Error(message);
    },
  };
}

export function capabilityBroker(): CapabilityIssuer & { issued: unknown[] } {
  const issued: unknown[] = [];
  return {
    issued,
    issue: async (req) => {
      issued.push(req);
      return {
        tokenId: `cap-${issued.length}`,
        expiresAt: Date.now() + 30 * 60_000,
      };
    },
  };
}

export function failingCapabilityBroker(message = 'no token for you'): CapabilityIssuer {
  return {
    issue: async () => {
      throw new Error(message);
    },
  };
}

export interface AdapterCall {
  kind: 'applyPhase' | 'rollbackPhase' | 'restoreSnapshot';
  input: DeployAdapterInput | SnapshotRestoreInput;
}

/** Record-everything adapter that returns the verdict you pre-load.
 * `verdicts[phase]` controls each call; if missing, defaults to ok. */
export function recordingAdapter(
  verdicts: Record<string, Partial<DeployAdapterOutput>> = {},
): ByocAdapter & { calls: AdapterCall[] } {
  const calls: AdapterCall[] = [];
  const respond = (input: DeployAdapterInput, kind: 'applyPhase' | 'rollbackPhase'): DeployAdapterOutput => {
    const v = verdicts[input.phase] ?? {};
    return {
      ok: v.ok ?? true,
      phase: input.phase,
      durationMs: v.durationMs ?? 1,
      ...(v.data !== undefined ? { data: v.data } : {}),
      ...(v.healthcheck !== undefined ? { healthcheck: v.healthcheck } : {}),
      ...(v.reason !== undefined ? { reason: v.reason } : {}),
      ...(v.undoToken !== undefined ? { undoToken: v.undoToken } : {}),
    };
  };
  return {
    calls,
    applyPhase: async (input) => {
      calls.push({ kind: 'applyPhase', input });
      return respond(input, 'applyPhase');
    },
    rollbackPhase: async (input) => {
      calls.push({ kind: 'rollbackPhase', input });
      return respond(input, 'rollbackPhase');
    },
    restoreSnapshot: async (input) => {
      calls.push({ kind: 'restoreSnapshot', input });
      return {
        ok: true,
        phase: 'snapshot-restore',
        durationMs: 1,
      };
    },
  };
}

export function throwingAdapter(message = 'adapter blew up'): ByocAdapter {
  return {
    applyPhase: async () => {
      throw new Error(message);
    },
    rollbackPhase: async () => {
      throw new Error(`rollback: ${message}`);
    },
    restoreSnapshot: async () => {
      throw new Error(`restore: ${message}`);
    },
  };
}

export function fakeClock(start = new Date('2026-05-25T12:00:00.000Z')): () => Date {
  let now = start.getTime();
  return () => new Date((now += 1));
}

export function okHealthcheck(): HealthcheckSnapshot {
  return { ok: true, status: 200, latencyMs: 12 };
}

export function badHealthcheck(): HealthcheckSnapshot {
  return { ok: false, status: 500, latencyMs: 12 };
}
