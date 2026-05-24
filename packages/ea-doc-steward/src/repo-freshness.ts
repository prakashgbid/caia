/**
 * Repo-freshness checker — scans the ADR repository for stale records:
 *   - missing or malformed Status line
 *   - missing Affected-components line
 *   - broken supersession links (X says superseded by Y but Y doesn't exist)
 *
 * Reports only — does not mutate. Coordinator can wire this into a
 * scheduled task per spec §4.5 (daily cadence recommended).
 */

import type { EaRepository } from '@caia/ea-architect';

import { parseSupersededBy } from './supersession-graph.js';
import type { FreshnessReport, StaleAdrFinding } from './types.js';

export class RepoFreshnessChecker {
  scan(repo: EaRepository, now: Date = new Date()): FreshnessReport {
    const stale: StaleAdrFinding[] = [];
    const knownIds = new Set(repo.adrs.map((a) => a.adrId));
    for (const adr of repo.adrs) {
      // 1. Status check.
      if (typeof adr.status !== 'string' || adr.status === '') {
        stale.push({
          adrId: adr.adrId,
          filePath: adr.filePath,
          reason: 'no-status',
          detail: 'ADR has no Status line'
        });
      } else if (
        !/^(Accepted|Proposed|Deprecated|Superseded)/i.test(adr.status) &&
        !/Superseded\s+by\s+ADR-\d+/i.test(adr.status)
      ) {
        stale.push({
          adrId: adr.adrId,
          filePath: adr.filePath,
          reason: 'status-malformed',
          detail: `Status "${adr.status}" doesn't match Accepted|Proposed|Deprecated|Superseded`
        });
      }
      // 2. Affected components check (best-effort).
      if (adr.affectedComponents.length === 0) {
        stale.push({
          adrId: adr.adrId,
          filePath: adr.filePath,
          reason: 'no-affected-components',
          detail: 'No Affected-components header'
        });
      }
      // 3. Broken supersession links.
      const sb = parseSupersededBy(adr);
      if (sb !== null && !knownIds.has(sb)) {
        stale.push({
          adrId: adr.adrId,
          filePath: adr.filePath,
          reason: 'broken-supersession',
          detail: `Says superseded by ${sb} which doesn't exist`
        });
      }
    }
    return {
      scannedCount: repo.adrs.length,
      stale,
      ranAtIso: now.toISOString()
    };
  }
}
