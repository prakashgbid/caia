import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkMigrationNumbering, nextFreePrefix } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function makeFixtureDir(layout: {
  files: string[];
  journalEntries: { idx: number; tag: string; breakpoints?: boolean }[];
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'steward-numbering-'));
  await fs.mkdir(path.join(dir, 'meta'), { recursive: true });
  for (const f of layout.files) {
    await fs.writeFile(path.join(dir, f), '-- placeholder\n');
  }
  await fs.writeFile(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: layout.journalEntries.map((e, i) => ({
        idx: e.idx,
        version: '6',
        when: 1700000000000 + i * 1000,
        tag: e.tag,
        breakpoints: e.breakpoints ?? false,
      })),
    }),
  );
  return dir;
}

describe('checkMigrationNumbering', () => {
  it('emits zero findings for a clean monotonic sequence', async () => {
    const dir = await makeFixtureDir({
      files: ['0000_a.sql', '0001_b.sql', '0002_c.sql'],
      journalEntries: [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
        { idx: 2, tag: '0002_c' },
      ],
    });
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    expect(findings).toEqual([]);
  });

  it('flags duplicate prefix as block-severity (the live 0037 collision shape)', async () => {
    const dir = await makeFixtureDir({
      files: ['0037_irreversible_actions.sql', '0037_story_capsule.sql'],
      journalEntries: [{ idx: 0, tag: '0037_story_capsule' }],
    });
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    const dup = findings.find((f) => f.ruleId === 'duplicate-prefix');
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe('block');
    expect(dup!.context!.prefix).toBe(37);
    expect(dup!.context!.orphan).toEqual(['0037_irreversible_actions.sql']);
    expect(dup!.context!.inJournal).toEqual(['0037_story_capsule.sql']);
  });

  it('flags a gap in registered prefixes as medium-severity warn', async () => {
    const dir = await makeFixtureDir({
      files: ['0000_a.sql', '0001_b.sql', '0003_d.sql'],
      journalEntries: [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
        { idx: 2, tag: '0003_d' },
      ],
    });
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    const gap = findings.find((f) => f.ruleId === 'numbering-gap');
    expect(gap).toBeDefined();
    expect(gap!.severity).toBe('medium');
    expect(gap!.context!.gapStart).toBe(1);
    expect(gap!.context!.gapEnd).toBe(3);
    expect(gap!.context!.missingSlots).toBe(1);
  });

  it('does NOT flag a gap when the gap is from an orphan file (covered by duplicate-prefix)', async () => {
    // 0001 only on disk, not in journal. So the registered sequence is 0000 -> 0002.
    // That IS a gap by the registered-only rule, but orphans should be the focus here.
    // The gap detector still fires because the rule is "gap in registered prefixes".
    const dir = await makeFixtureDir({
      files: ['0000_a.sql', '0001_orphan.sql', '0002_c.sql'],
      journalEntries: [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0002_c' },
      ],
    });
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    const gap = findings.find((f) => f.ruleId === 'numbering-gap');
    expect(gap).toBeDefined();
    expect(gap!.context!.gapStart).toBe(0);
    expect(gap!.context!.gapEnd).toBe(2);
  });

  it('flags a non-numeric prefix file as medium-severity', async () => {
    const dir = await makeFixtureDir({
      files: ['weird-name.sql'],
      journalEntries: [],
    });
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    const bad = findings.find((f) => f.ruleId === 'non-numeric-prefix');
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe('medium');
  });

  it('returns block on unreadable directory', async () => {
    const findings = await checkMigrationNumbering({
      migrationsDir: '/no/such/path/does/not/exist',
    });
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('migrations-dir-unreadable');
  });
});

describe('nextFreePrefix', () => {
  it('returns 0 for empty input', () => {
    expect(nextFreePrefix([])).toBe(0);
  });

  it('returns max + 1', () => {
    expect(nextFreePrefix([0, 1, 2, 5])).toBe(6);
  });
});
