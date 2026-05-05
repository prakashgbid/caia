/**
 * Memory drift scanner.
 *
 * Compares the count of `*.md` files in `<memoryDir>/` against the
 * count of entries in `MEMORY.md` (the index). Per the directive's
 * dimension #14 (Memory drift) + #1 (Code health: Schema evolution),
 * a growing gap between disk + index is a known-bad pattern that bit
 * us on 2026-05-03 (46 files on disk, 27 in index).
 *
 * The scanner is pure-ish: it reads the filesystem but does not exec
 * shell commands, so the test path doesn't need a mocked shell.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Finding, ScanContext, Scanner } from '../types.js';

export const memoryDriftScanner: Scanner = {
  id: 'memory-drift',
  name: 'Memory file/index drift',
  category: 'Code Health & Maintainability',
  scan(ctx: ScanContext): Finding[] {
    const memoryDir = ctx.memoryDir;
    if (!existsSync(memoryDir) || !statSync(memoryDir).isDirectory()) {
      return [
        {
          scannerId: 'memory-drift',
          dimension: 'Memory drift',
          category: 'Code Health & Maintainability',
          severity: 'high',
          title: 'Memory directory missing',
          detail: `Configured memory dir does not exist: \`${memoryDir}\``,
          evidence: [`stat: ${memoryDir} → not a directory`],
          recommendation:
            'Verify CAIA_MEMORY_DIR env var or pass --memory <dir> to caia-curator.',
          effort: 'trivial',
          impactScore: 80,
          detectedAt: (ctx.now ?? ((): Date => new Date()))().toISOString()
        }
      ];
    }

    // Count .md files at the memory-dir root (not recursive — index is flat per directive).
    const allFiles = readdirSync(memoryDir).filter(
      (f) => f.endsWith('.md') && f !== 'MEMORY.md'
    );
    const onDiskCount = allFiles.length;

    // Try to count entries in MEMORY.md by counting markdown link/file references.
    const indexPath = join(memoryDir, 'MEMORY.md');
    const indexExists = existsSync(indexPath);
    let indexedCount = 0;
    if (indexExists) {
      const indexBody = readFileSync(indexPath, 'utf-8');
      // Match either `[label](file.md)` link form or bare `file.md` references.
      const linkMatches = indexBody.match(/\[[^\]]+\]\([^)]+\.md\)/g) ?? [];
      const bareMatches = indexBody.match(/\b[a-z0-9_]+\.md\b/gi) ?? [];
      // Use the larger of the two so we don't undercount when both styles mix.
      indexedCount = Math.max(
        new Set(linkMatches).size,
        new Set(bareMatches).size
      );
    }

    const findings: Finding[] = [];
    const detectedAt = (ctx.now ?? ((): Date => new Date()))().toISOString();

    if (!indexExists) {
      findings.push({
        scannerId: 'memory-drift',
        dimension: 'Memory drift',
        category: 'Code Health & Maintainability',
        severity: 'high',
        title: 'MEMORY.md index missing',
        detail: `\`${indexPath}\` not found, but ${onDiskCount} memory files exist on disk.`,
        evidence: [`onDiskCount: ${onDiskCount}`],
        recommendation:
          'Generate a MEMORY.md index that lists all memory files (per `consolidation_action_list_2026-04-28.md`).',
        effort: 'small',
        impactScore: 70,
        detectedAt
      });
      return findings;
    }

    const drift = onDiskCount - indexedCount;
    if (drift >= 5) {
      findings.push({
        scannerId: 'memory-drift',
        dimension: 'Memory drift',
        category: 'Code Health & Maintainability',
        severity: drift >= 15 ? 'high' : 'medium',
        title: `Memory index drift: ${drift} files on disk not in MEMORY.md`,
        detail: `\`MEMORY.md\` references ~${indexedCount} files, but ${onDiskCount} \`*.md\` files exist under \`${memoryDir}\`. Drift = ${drift}.`,
        evidence: [
          `onDiskCount: ${onDiskCount}`,
          `indexedCount: ${indexedCount}`,
          `firstUnindexed: ${allFiles.slice(0, 5).join(', ')}${allFiles.length > 5 ? ', ...' : ''}`
        ],
        recommendation:
          'Run a memory-consolidation pass: add new files to MEMORY.md, archive stale ones to *.bak, ensure index reflects current state.',
        effort: 'small',
        impactScore: drift >= 15 ? 80 : 50,
        detectedAt
      });
    } else {
      findings.push({
        scannerId: 'memory-drift',
        dimension: 'Memory drift',
        category: 'Code Health & Maintainability',
        severity: 'info',
        title: `Memory index in sync (drift ≤ 5)`,
        detail: `\`MEMORY.md\` references ~${indexedCount} files, ${onDiskCount} on disk. Drift = ${drift}.`,
        evidence: [
          `onDiskCount: ${onDiskCount}`,
          `indexedCount: ${indexedCount}`
        ],
        recommendation: 'No action.',
        effort: 'trivial',
        impactScore: 5,
        detectedAt
      });
    }

    return findings;
  }
};
