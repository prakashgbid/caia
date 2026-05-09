/**
 * Approvals — checksum verification + approvals.json Zod schema.
 *
 * Ported from Stolution's @stolution/vastu-figma-bridge/src/approvals.ts
 * with parameterization for approvalsPath (optional, from VastuConfig).
 *
 * approvals.json schema:
 * {
 *   "<pageId>": {
 *     "status": "proposed" | "figma-approved" | "implemented",
 *     "approver": string,
 *     "approvedAt": ISO8601,
 *     "figmaUrl": string | null,
 *     "checksum": "sha256:<hex>",
 *     "notes": string
 *   }
 * }
 */

import * as fs from 'node:fs';
import { z } from 'zod';

export const ApprovalStatus = z.enum(['proposed', 'figma-approved', 'implemented']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalEntrySchema = z.object({
  status: ApprovalStatus,
  approver: z.string().default(''),
  approvedAt: z.string().nullable().optional(),
  figmaUrl: z.string().nullable().default(null),
  checksum: z.string().default(''),
  notes: z.string().default(''),
});

export type ApprovalEntry = z.infer<typeof ApprovalEntrySchema>;

export const ApprovalsRegistrySchema = z.record(z.string(), ApprovalEntrySchema);
export type ApprovalsRegistry = z.infer<typeof ApprovalsRegistrySchema>;

export interface ApprovalVerdict {
  pageId: string;
  status: ApprovalStatus | 'missing';
  checksumMatches: boolean;
  drift: boolean;
  entry?: ApprovalEntry;
}

/**
 * Read approvals.json from the specified path.
 * Returns empty object if the file doesn't exist (dry-run mode).
 */
export function readApprovals(filePath: string): ApprovalsRegistry {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `approvals.json is malformed: ${(err as Error).message}. Fix JSON syntax before proceeding.`,
      { cause: err }
    );
  }
  return ApprovalsRegistrySchema.parse(parsed);
}

/**
 * Verify a pageId's checksum against the stored approvals.
 * Returns verdict with status, checksumMatches, and drift flag.
 */
export function verifyApprovals(
  pageId: string,
  checksum: string,
  filePath: string
): ApprovalVerdict {
  const registry = readApprovals(filePath);
  const entry = registry[pageId];

  if (!entry) {
    return { pageId, status: 'missing', checksumMatches: false, drift: true };
  }

  const checksumMatches = entry.checksum === checksum;

  return {
    pageId,
    status: entry.status,
    checksumMatches,
    drift: !checksumMatches,
    entry,
  };
}
