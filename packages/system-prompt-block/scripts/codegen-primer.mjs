#!/usr/bin/env node
/**
 * Build-time codegen — writes the generated CAIA primer to
 * `dist/caia-primer.md` as a stable fixture artifact, so consumers can
 * read it directly without spinning up the generator at runtime.
 *
 * Inputs (resolved from the operator's HOME):
 *   ~/Library/Application Support/Claude/local-agent-mode-sessions/
 *     <session-id>/agent/memory/MEMORY.md
 *   …/agent/memory/caia_architecture.md
 *   …/agent/memory/master_backlog_sequencing_2026-05-05.md
 *
 * Output:
 *   packages/system-prompt-block/dist/caia-primer.md
 *
 * Behaviour:
 *   - If the source files are not present (e.g. building inside CI
 *     where the operator's session memory is not mounted), the codegen
 *     skips with a non-zero exit but writes a placeholder file so the
 *     dist tree is still complete. The error is logged to stderr.
 *   - Otherwise, the primer is generated with summariseOnOverflow=true
 *     and the budget assertion (estimatedTokens ≤ 1000) is hard.
 *
 * Determinism: same source inputs ⇒ byte-identical output. Run twice
 * and diff to verify.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateCaiaPrimer } from '../dist/generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const DIST = join(PKG_ROOT, 'dist');

const SESSIONS_ROOT = join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'local-agent-mode-sessions'
);

/**
 * Find a single session directory containing an agent/memory/MEMORY.md.
 * Local-agent-mode-sessions has a two-level shape:
 *   sessions/<outer>/<inner>/agent/memory/MEMORY.md
 * We pick the most-recently-modified inner that has the expected file.
 *
 * Returns the absolute path of the agent/memory directory, or null if
 * no such directory is found.
 */
function locateMemoryDir() {
  if (!existsSync(SESSIONS_ROOT)) return null;
  let best = null;
  let bestMtime = -Infinity;
  for (const outer of readdirSync(SESSIONS_ROOT)) {
    const outerPath = join(SESSIONS_ROOT, outer);
    let outerStat;
    try {
      outerStat = statSync(outerPath);
    } catch {
      continue;
    }
    if (!outerStat.isDirectory()) continue;
    let innerEntries;
    try {
      innerEntries = readdirSync(outerPath);
    } catch {
      continue;
    }
    for (const inner of innerEntries) {
      const memoryDir = join(outerPath, inner, 'agent', 'memory');
      const memoryFile = join(memoryDir, 'MEMORY.md');
      if (!existsSync(memoryFile)) continue;
      const st = statSync(memoryFile);
      if (st.mtimeMs > bestMtime) {
        best = memoryDir;
        bestMtime = st.mtimeMs;
      }
    }
  }
  return best;
}

function writeDistFile(name, content) {
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, name), content, 'utf-8');
}

function main() {
  const memoryDir = locateMemoryDir();
  if (memoryDir === null) {
    const placeholder =
      '# CAIA Primer (placeholder)\n\n' +
      'Codegen skipped — operator session memory not available at build ' +
      'time (likely a CI build without the operator’s HOME). The runtime ' +
      'CLI generates the live primer from the active session memory.\n';
    writeDistFile('caia-primer.md', placeholder);
    console.warn(
      'codegen-primer: operator session memory not found under ' +
        `${SESSIONS_ROOT} — wrote placeholder.`
    );
    return 0;
  }

  const memoryIndexPath = join(memoryDir, 'MEMORY.md');
  const architectureDocPath = join(memoryDir, 'caia_architecture.md');
  const dodSourcePath = join(memoryDir, 'master_backlog_sequencing_2026-05-05.md');

  for (const p of [memoryIndexPath, architectureDocPath, dodSourcePath]) {
    if (!existsSync(p)) {
      console.warn(`codegen-primer: missing source ${p} — wrote placeholder.`);
      writeDistFile(
        'caia-primer.md',
        '# CAIA Primer (placeholder)\n\nCodegen skipped: missing source.\n'
      );
      return 0;
    }
  }

  const result = generateCaiaPrimer({
    memoryIndexPath,
    architectureDocPath,
    dodSourcePath,
    summariseOnOverflow: true
  });

  if (result.estimatedTokens > 1000) {
    console.error(
      `codegen-primer: primer is ${result.estimatedTokens} tokens, over the ` +
        `1000-token budget — this should not happen with summariseOnOverflow.`
    );
    return 1;
  }

  writeDistFile('caia-primer.md', result.text);
  console.log(
    `codegen-primer: wrote dist/caia-primer.md ` +
      `(${result.estimatedTokens} est. tokens` +
      `${result.trimmed ? ', trimmed' : ''}).`
  );
  return 0;
}

process.exit(main());
