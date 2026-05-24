/**
 * ADR auto-filer — inherits writeNewAdr / applySupersessions /
 * updateDecisionsIndex from @caia/ea-architect/src/adr-writer and extends
 * them with the supersession-graph validator.
 *
 * Per spec §4.5, the Steward runs synchronously after every Plan Reviewer
 * approval, before the sign-off document is composed. The Coordinator
 * passes the dialogue log path so the Steward can mine Consequences-section
 * content from the Defender's answers.
 */

import {
  applySupersessions,
  defaultFsAdapter,
  markSupersededBy,
  updateDecisionsIndex,
  writeNewAdr
} from '@caia/ea-architect';

import { validateSupersessionGraph } from './supersession-graph.js';
import type { FiledAdrRef, StewardFilingInput, StewardFilingOutput } from './types.js';

export class AdrFiler {
  async file(input: StewardFilingInput): Promise<StewardFilingOutput> {
    const fs = input.fs ?? defaultFsAdapter;
    const now = (input.clock ?? ((): Date => new Date()))();
    const filedAdrs: FiledAdrRef[] = [];
    const supersessionsApplied: StewardFilingOutput['supersessionsApplied'] = [];

    // Mutate a working copy of the repo so subsequent writeNewAdr calls
    // see the prior writes (ids advance correctly).
    const workingRepo = { ...input.repo, adrs: [...input.repo.adrs], maxAdrId: input.repo.maxAdrId };

    for (const draft of input.newAdrsToFile) {
      const written = writeNewAdr(workingRepo, draft, now, fs);
      filedAdrs.push({ ...written, title: draft.title });
      // Reflect into working repo so the next draft's id increments correctly.
      workingRepo.maxAdrId = Math.max(workingRepo.maxAdrId, written.id);
      workingRepo.adrs.push({
        id: written.id,
        adrId: written.adrId,
        filePath: written.filePath,
        title: draft.title,
        status: draft.status,
        affectedComponents: draft.affectedComponents ?? [],
        body: `# ${written.adrId} — ${draft.title}\n\nStatus: ${draft.status}\n`,
        keywords: []
      });
    }

    if (filedAdrs.length > 0) {
      // Apply explicit affected-existing-adrs supersessions.
      applySupersessions(fs, workingRepo, input.affectedExistingAdrs, filedAdrs);
      for (const aff of input.affectedExistingAdrs) {
        if (aff.action === 'supersede') {
          const newAdrId = filedAdrs[0]?.adrId;
          if (newAdrId !== undefined) {
            supersessionsApplied.push({ supersededAdr: aff.adrId, bySupersedingAdr: newAdrId });
          }
        }
      }
      // Apply implicit supersessions named on the draft itself.
      for (const draft of input.newAdrsToFile) {
        if (draft.supersedes === undefined) continue;
        for (const supId of draft.supersedes) {
          const existingAdr = workingRepo.adrs.find((a) => a.adrId === supId);
          if (existingAdr === undefined) continue;
          const newRef = filedAdrs.find((f) => f.title === draft.title);
          if (newRef === undefined) continue;
          markSupersededBy(fs, existingAdr.filePath, newRef.adrId);
          supersessionsApplied.push({ supersededAdr: supId, bySupersedingAdr: newRef.adrId });
        }
      }
      // Update INDEX.md.
      updateDecisionsIndex(fs, workingRepo, filedAdrs);
    }

    // Validate the post-filing supersession graph.
    const graph = validateSupersessionGraph(workingRepo);

    return {
      filedAdrs,
      supersessionsApplied,
      indexUpdated: filedAdrs.length > 0,
      supersessionGraph: graph
    };
  }
}
