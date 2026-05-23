import type { ProjectState } from './states.js';

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
  constructor(
    public readonly from: ProjectState,
    public readonly to: ProjectState,
    public readonly reasonDetail?: string,
  ) {
    super(
      reasonDetail
        ? `invalid transition ${from} -> ${to}: ${reasonDetail}`
        : `invalid transition ${from} -> ${to}`,
    );
  }
}

export class StaleProjectVersionError extends Error {
  override name = 'StaleProjectVersionError';
  constructor(
    public readonly projectId: string,
    public readonly expectedVersion: number,
  ) {
    super(
      `project ${projectId} version ${expectedVersion} is stale - another writer won the race`,
    );
  }
}

export class ProjectNotFoundError extends Error {
  override name = 'ProjectNotFoundError';
  constructor(public readonly projectId: string) {
    super(`project ${projectId} not found`);
  }
}

export class AdvisoryLockHeldError extends Error {
  override name = 'AdvisoryLockHeldError';
  constructor(public readonly projectId: string) {
    super(`advisory lock already held for project ${projectId}`);
  }
}

export class TicketAlreadyClaimedError extends Error {
  override name = 'TicketAlreadyClaimedError';
  constructor(
    public readonly ticketId: string,
    public readonly claimedBy?: string,
  ) {
    super(
      `ticket ${ticketId} already claimed${claimedBy ? ` by ${claimedBy}` : ''}`,
    );
  }
}

export class TransitionRetryExhaustedError extends Error {
  override name = 'TransitionRetryExhaustedError';
  constructor(
    public readonly projectId: string,
    public readonly attempts: number,
  ) {
    super(
      `transition for project ${projectId} retried ${attempts} times without progress`,
    );
  }
}
