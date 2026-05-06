/**
 * Installer + verifier for CAIA Claude Code subagents.
 *
 * Both functions are pure-ish: they take options, perform fs operations,
 * and return a structured result. No process-wide side effects (no
 * console.log, no exit). Wrapped by `cli.ts` which adds the I/O layer.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MANIFEST } from './manifest.js';
import { defaultTargetDir, shippedAgentsDir } from './paths.js';
import type {
  InstallFileResult,
  InstallOptions,
  InstallResult,
  SubagentManifestEntry,
  VerifyFileResult,
  VerifyResult
} from './types.js';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function selectEntries(
  only: readonly string[] | undefined
): readonly SubagentManifestEntry[] {
  if (!only || only.length === 0) return MANIFEST.entries;
  const set = new Set(only);
  const matched = MANIFEST.entries.filter((e) => set.has(e.name));
  const unknownNames = only.filter(
    (n) => !MANIFEST.entries.some((e) => e.name === n)
  );
  if (unknownNames.length > 0) {
    throw new Error(
      `[claude-subagents] unknown subagent name(s): ${unknownNames.join(', ')}. ` +
        `Available: ${MANIFEST.entries.map((e) => e.name).join(', ')}`
    );
  }
  return matched;
}

/**
 * Install (or refresh) the shipped subagent .md files into the target
 * directory. Idempotent — files whose on-disk SHA matches the shipped
 * SHA are skipped unless `force` is `true`.
 */
export function installSubagents(opts: InstallOptions = {}): InstallResult {
  const targetDir = opts.targetDir ?? defaultTargetDir();
  const force = opts.force === true;
  const entries = selectEntries(opts.only);

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const shippedDir = shippedAgentsDir();
  const results: InstallFileResult[] = [];
  let writtenCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;

  for (const entry of entries) {
    const sourcePath = join(shippedDir, entry.filename);
    const targetPath = join(targetDir, entry.filename);
    const shippedContent = readFileSync(sourcePath, 'utf-8');

    if (existsSync(targetPath)) {
      const onDisk = readFileSync(targetPath, 'utf-8');
      if (sha256(onDisk) === sha256(shippedContent) && !force) {
        results.push({ name: entry.name, path: targetPath, action: 'skipped-unchanged' });
        skippedCount++;
        continue;
      }
      writeFileSync(targetPath, shippedContent, 'utf-8');
      results.push({ name: entry.name, path: targetPath, action: 'overwritten' });
      overwrittenCount++;
      continue;
    }

    writeFileSync(targetPath, shippedContent, 'utf-8');
    results.push({ name: entry.name, path: targetPath, action: 'written' });
    writtenCount++;
  }

  return {
    targetDir,
    results,
    writtenCount,
    skippedCount,
    overwrittenCount
  };
}

/**
 * Verify the on-disk subagent files match the shipped definitions. No
 * mutation. Returns per-file status + an aggregate `ok` flag.
 */
export function verifyInstalled(opts: InstallOptions = {}): VerifyResult {
  const targetDir = opts.targetDir ?? defaultTargetDir();
  const entries = selectEntries(opts.only);
  const shippedDir = shippedAgentsDir();
  const results: VerifyFileResult[] = [];
  let presentCount = 0;
  let driftedCount = 0;
  let missingCount = 0;

  for (const entry of entries) {
    const targetPath = join(targetDir, entry.filename);
    const sourcePath = join(shippedDir, entry.filename);
    const shippedContent = readFileSync(sourcePath, 'utf-8');
    const shippedSha = sha256(shippedContent);

    if (!existsSync(targetPath)) {
      results.push({ name: entry.name, path: targetPath, status: 'missing' });
      missingCount++;
      continue;
    }
    const onDiskContent = readFileSync(targetPath, 'utf-8');
    const onDiskSha = sha256(onDiskContent);
    if (onDiskSha === shippedSha) {
      results.push({ name: entry.name, path: targetPath, status: 'present-matches' });
      presentCount++;
      continue;
    }
    results.push({
      name: entry.name,
      path: targetPath,
      status: 'present-drifted',
      onDiskSha,
      shippedSha
    });
    driftedCount++;
  }

  return {
    targetDir,
    results,
    presentCount,
    driftedCount,
    missingCount,
    ok: presentCount === entries.length
  };
}
