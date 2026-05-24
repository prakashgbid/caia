/**
 * EA Ticket Auditor — the pre-architecture gate.
 *
 * Runs the 15-point DoD checks + the non-functional sibling detector and
 * composes a TicketAuditVerdict.
 */

import { DEFAULT_DOD_CHECKS } from './dod-checklist.js';
import { findMissingNonFunctional } from './non-functional-detector.js';
import type {
  DodCheckItem,
  TicketAuditInput,
  TicketAuditVerdict,
  TicketAuditorConfig
} from './types.js';

export class EaTicketAuditor {
  private readonly dodChecks: DodCheckItem[];
  private readonly clock: () => Date;

  constructor(cfg: TicketAuditorConfig = {}) {
    this.dodChecks = cfg.dodChecks ?? DEFAULT_DOD_CHECKS;
    this.clock = cfg.clock ?? ((): Date => new Date());
  }

  audit(input: TicketAuditInput): TicketAuditVerdict {
    const dodResults = this.dodChecks.map((c) => {
      const r = c.check(input.ticketBody);
      const item: { id: string; title: string; pass: boolean; reason?: string } = {
        id: c.id,
        title: c.title,
        pass: r.pass
      };
      if (r.reason !== undefined) item.reason = r.reason;
      return item;
    });
    const missingNonFunctional = findMissingNonFunctional(input);
    const passedDod = dodResults.filter((r) => r.pass).length;
    const total = this.dodChecks.length;
    const completenessScore = total === 0 ? 1 : passedDod / total;
    const pass = passedDod === total && missingNonFunctional.length === 0;
    const reasoning = pass
      ? `Ticket passes all ${total} Definition of Done checks and has all four non-functional siblings present. Completeness: ${(completenessScore * 100).toFixed(0)}%.`
      : `Ticket fails ${total - passedDod}/${total} DoD checks and is missing non-functional coverage for: ${missingNonFunctional.join(', ') || '(none)'}. Completeness: ${(completenessScore * 100).toFixed(0)}%.`;
    return {
      ticketId: input.ticketId,
      pass,
      dodResults,
      missingNonFunctional,
      completenessScore,
      reviewedAtIso: this.clock().toISOString(),
      reasoning
    };
  }
}
