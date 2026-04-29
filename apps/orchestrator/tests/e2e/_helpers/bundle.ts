/**
 * Map an orchestrator `TicketBundle` (the raw DB shape returned by
 * `getTicketBundle`) to the `worker-coding` `Bundle` envelope (the
 * Zod-validated shape `BundleReader` returns over the wire).
 *
 * The two are field-for-field equivalent — the worker-coding Bundle
 * is a typed mirror of the orchestrator's TicketBundle. Re-mapping
 * here keeps the regression tests honest about the contract surface.
 */

import type { TicketBundle } from '../../../src/api/ticket-bundle';
import type { Bundle as CoderBundle } from '../../../../worker-coding/src/bundle-reader';

export function ticketBundleToCoderBundle(b: TicketBundle): CoderBundle {
  return {
    story: {
      id: b.story.id,
      title: b.story.title,
      description: b.story.description,
      status: b.story.status,
      rootPromptId: b.story.rootPromptId,
      parentEntityId: b.story.parentEntityId,
      parentEntityType: b.story.parentEntityType,
      bucketId: b.story.bucketId,
      templateVersion: b.story.templateVersion,
      templateValidationStatus: b.story.templateValidationStatus,
      templateValidationErrors: b.story.templateValidationErrors ?? null,
      enrichedAt: b.story.enrichedAt ?? null,
      updatedAt: b.story.updatedAt ?? null,
    },
    ticket: b.ticket,
    ticketParseError: b.ticketParseError,
    prompt: b.prompt,
    requirement: b.requirement,
    bucket: b.bucket,
    labels: b.labels,
    dependencies: b.dependencies,
    inputDependencies: b.inputDependencies,
  };
}
