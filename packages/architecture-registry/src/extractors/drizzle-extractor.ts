/**
 * @chiefaia/architecture-registry — drizzle schema + migration extractor
 * (ARCH-003)
 *
 * Two pure transformations:
 *
 * 1. extractSchemasFromDrizzleSource(source)
 *      Walks a single drizzle schema TypeScript file (e.g. apps/orchestrator/
 *      src/db/schema.ts) and emits one ArchArtifactRow per `sqliteTable(...)`
 *      / `pgTable(...)` declaration. Captures column names + types + nullable
 *      + defaults + indexes + FKs into SchemaMetadata.
 *
 *      The walk uses ts-morph (already pulled in for ARCH-002) instead of
 *      drizzle-kit introspect so we don't need a live database. Drizzle
 *      schemas are pure code — the source is the truth.
 *
 * 2. extractMigrationsFromMigrationsDir(dir)
 *      Reads every `*.sql` file in a drizzle migrations directory + the
 *      `meta/_journal.json` to emit one ArchArtifactRow per migration with
 *      `kind='migration'` and MigrationMetadata. Captures sequence number,
 *      filename, sha256 checksum, parsed `affectsTables`, and applied
 *      status (true if listed in _journal.json).
 *
 * Both extractors are idempotent — re-running yields stable dedup keys.
 */

import { nanoid } from 'nanoid';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  Project,
  ScriptKind,
  SyntaxKind,
  type CallExpression,
  type SourceFile,
  type ObjectLiteralExpression,
  type ArrayLiteralExpression,
} from 'ts-morph';
import {
  ArchArtifactRowSchema,
  SchemaMetadataSchema,
  MigrationMetadataSchema,
  type ArchArtifactRow,
  type SchemaMetadata,
  type MigrationMetadata,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../schema';
import { computeArtifactDedupKey } from '../dedup-key';
import type { ExtractionResult, ExtractorOptions } from './ts-morph-types';
import { sha256 } from './utils';

// ─── Schema extractor ───────────────────────────────────────────────────────

const TABLE_BUILDER_NAMES = new Set(['sqliteTable', 'pgTable', 'mysqlTable', 'table']);

interface ExtractedColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
}

function inferDrizzleColumnType(callText: string): string {
  // text('col', ...) → 'text'; integer('col', { mode: 'boolean' }) → 'integer';
  // timestamp('col') → 'timestamp'; etc. We extract the leading function name.
  const m = /^(\w+)\(/.exec(callText.trim());
  return m?.[1] ?? 'unknown';
}

function parseColumnsObjectLiteral(obj: ObjectLiteralExpression): ExtractedColumn[] {
  const cols: ExtractedColumn[] = [];
  for (const prop of obj.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    const colName = pa.getName();
    const init = pa.getInitializer();
    if (!init) continue;
    const initText = init.getText();
    const type = inferDrizzleColumnType(initText);
    const isPrimaryKey = /\.primaryKey\(/.test(initText);
    const isUnique = /\.unique\(/.test(initText);
    // Primary keys are implicitly NOT NULL even without .notNull().
    const nullable = !isPrimaryKey && !/\.notNull\(/.test(initText);
    const defaultMatch = /\.default\(([^)]+)\)/.exec(initText);
    cols.push({
      name: colName,
      type,
      nullable,
      defaultValue: defaultMatch?.[1]?.trim(),
      isPrimaryKey,
      isUnique,
    });
  }
  return cols;
}

interface ExtractedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

function parseIndexesArray(arr: ArrayLiteralExpression): ExtractedIndex[] {
  const out: ExtractedIndex[] = [];
  for (const elem of arr.getElements()) {
    const text = elem.getText();
    // index('foo_idx').on(t.x, t.y) or uniqueIndex('foo_idx').on(t.x)
    const nameMatch = /^(?:unique)?index\(\s*['"]([^'"]+)['"]\s*\)/i.exec(text);
    if (!nameMatch) continue;
    const onMatch = /\.on\(([^)]+)\)/.exec(text);
    const columns = onMatch?.[1]
      ? onMatch[1]
          .split(',')
          .map((c) => c.trim().replace(/^t\./, ''))
          .filter((c) => c.length > 0)
      : [];
    out.push({
      name: nameMatch[1]!,
      columns,
      unique: /^uniqueIndex\(/i.test(text),
    });
  }
  return out;
}

interface ExtractedTable {
  exportName: string;
  tableName: string;
  columns: ExtractedColumn[];
  indexes: ExtractedIndex[];
}

function inspectTableCall(call: CallExpression, exportName: string): ExtractedTable | undefined {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.Identifier) return undefined;
  const builderName = expr.getText();
  if (!TABLE_BUILDER_NAMES.has(builderName)) return undefined;

  const args = call.getArguments();
  if (args.length < 2) return undefined;
  const tableNameArg = args[0];
  const colsArg = args[1];
  if (!tableNameArg || tableNameArg.getKind() !== SyntaxKind.StringLiteral) return undefined;
  const tableName = tableNameArg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
  if (!colsArg || colsArg.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;

  const columns = parseColumnsObjectLiteral(colsArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression));

  // Third arg is optional (t) => [ index(...).on(...), ... ]
  let indexes: ExtractedIndex[] = [];
  if (args.length >= 3) {
    const third = args[2]!;
    const arrow = third.asKind(SyntaxKind.ArrowFunction);
    if (arrow) {
      const body = arrow.getBody();
      const arr = body.getKind() === SyntaxKind.ArrayLiteralExpression
        ? body.asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
        : body.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)[0];
      if (arr) indexes = parseIndexesArray(arr);
    }
  }

  return { exportName, tableName, columns, indexes };
}

function findTableExports(sf: SourceFile): Array<{ exportName: string; call: CallExpression }> {
  const out: Array<{ exportName: string; call: CallExpression }> = [];
  for (const v of sf.getVariableDeclarations()) {
    const stmt = v.getVariableStatement();
    if (!stmt?.isExported()) continue;
    const init = v.getInitializer();
    if (!init) continue;
    if (init.getKind() === SyntaxKind.CallExpression) {
      out.push({ exportName: v.getName(), call: init.asKindOrThrow(SyntaxKind.CallExpression) });
    }
  }
  return out;
}

export function extractSchemasFromInMemorySource(
  source: { path: string; content: string },
  opts: ExtractorOptions,
): ExtractionResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, allowJs: true, target: 99 },
  });
  const sf = project.createSourceFile(source.path, source.content, { scriptKind: ScriptKind.TS });
  return extractSchemasFromSourceFile(sf, opts);
}

export function extractSchemasFromFile(filePath: string, opts: ExtractorOptions): ExtractionResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { strict: false, allowJs: true, target: 99 },
  });
  const sf = project.addSourceFileAtPath(filePath);
  return extractSchemasFromSourceFile(sf, opts);
}

function extractSchemasFromSourceFile(sf: SourceFile, opts: ExtractorOptions): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);
  const filePath = relativize(opts.repoRoot, sf.getFilePath());
  const fileText = sf.getFullText();
  const contentHash = sha256(fileText);

  const exports = findTableExports(sf);
  for (const { exportName, call } of exports) {
    try {
      const t = inspectTableCall(call, exportName);
      if (!t) continue;

      const meta: SchemaMetadata = SchemaMetadataSchema.parse({
        tableName: t.tableName,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          ...(c.defaultValue ? { defaultValue: c.defaultValue } : {}),
          isPrimaryKey: c.isPrimaryKey,
          isUnique: c.isUnique,
        })),
        indexes: t.indexes.map((i) => ({
          name: i.name,
          columns: i.columns,
          unique: i.unique,
        })),
        foreignKeys: [],
      });

      const id = newId('arch');
      const dedupKey = computeArtifactDedupKey({
        project: opts.defaultProject,
        kind: 'schema',
        name: t.tableName,
        tableName: t.tableName,
      });

      const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
        id,
        kind: 'schema',
        project: opts.defaultProject,
        name: t.tableName,
        description: `SQLite table '${t.tableName}' (${t.columns.length} columns, ${t.indexes.length} indexes)`,
        keySignature: `export const ${exportName} = ${call.getExpression().getText()}('${t.tableName}', { ${t.columns.map((c) => c.name).join(', ')} })`,
        filePaths: [filePath],
        entryPath: filePath,
        tableName: t.tableName,
        techSubDomains: ['database'],
        tags: [],
        metadataJson: JSON.stringify(meta),
        source: 'drizzle_introspect',
        contentHash,
        extractedAtCommit: opts.extractedAtCommit,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingDim: DEFAULT_EMBEDDING_DIM,
        embeddingVersion: DEFAULT_EMBEDDING_VERSION,
        createdAt: opts.now,
        updatedAt: opts.now,
        dedupKey,
      });
      result.artifacts.push(artifact);
    } catch (err) {
      result.warnings.push(
        `drizzle-extractor: ${filePath}#${exportName} → ${(err as Error).message}`,
      );
    }
  }
  return result;
}

// ─── Migration extractor ────────────────────────────────────────────────────

const MIGRATION_FILENAME_RE = /^(\d{4})_(.+)\.sql$/;

const SQL_TABLE_RE = /CREATE\s+(?:TABLE|INDEX|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi;

function parseAffectedTablesFromSql(sql: string): string[] {
  const tables = new Set<string>();
  let m: RegExpExecArray | null;
  // Parse CREATE TABLE / CREATE INDEX / CREATE VIRTUAL TABLE.
  while ((m = SQL_TABLE_RE.exec(sql)) !== null) {
    if (m[1]) tables.add(m[1]);
  }
  // ALTER TABLE
  for (const am of sql.matchAll(/ALTER\s+TABLE\s+[`"]?(\w+)[`"]?/gi)) {
    if (am[1]) tables.add(am[1]);
  }
  return Array.from(tables);
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface JournalShape {
  entries: JournalEntry[];
}

function readJournal(metaDir: string): JournalShape | undefined {
  const path = join(metaDir, '_journal.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as JournalShape;
  } catch {
    return undefined;
  }
}

export function extractMigrationsFromMigrationsDir(
  migrationsDir: string,
  opts: ExtractorOptions,
): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  if (!existsSync(migrationsDir)) {
    result.warnings.push(`migrations dir ${migrationsDir} not found; skipped`);
    return result;
  }
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);
  const metaDir = join(migrationsDir, 'meta');
  const journal = readJournal(metaDir);
  const appliedTags = new Set<string>(journal?.entries.map((e) => e.tag) ?? []);

  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch (err) {
    result.warnings.push(`cannot list ${migrationsDir} → ${(err as Error).message}`);
    return result;
  }

  for (const fileName of entries.sort()) {
    const m = MIGRATION_FILENAME_RE.exec(fileName);
    if (!m) continue;
    const seq = Number(m[1]);
    const tag = `${m[1]}_${m[2]}`;
    const fullPath = join(migrationsDir, fileName);
    let sql: string;
    try {
      sql = readFileSync(fullPath, 'utf8');
    } catch (err) {
      result.warnings.push(`cannot read ${fileName} → ${(err as Error).message}`);
      continue;
    }
    const checksum = sha256(sql);
    const affectsTables = parseAffectedTablesFromSql(sql);
    const isApplied = appliedTags.has(tag);

    const meta: MigrationMetadata = MigrationMetadataSchema.parse({
      fileName,
      sequenceNumber: seq,
      checksum,
      affectsTables,
      isApplied,
    });

    const repoRel = relativize(opts.repoRoot, fullPath);
    const id = newId('arch');
    const dedupKey = computeArtifactDedupKey({
      project: opts.defaultProject,
      kind: 'migration',
      name: fileName,
      entryPath: repoRel,
    });

    const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
      id,
      kind: 'migration',
      project: opts.defaultProject,
      name: fileName,
      description: `Drizzle migration ${fileName} — affects ${affectsTables.length === 0 ? 'no tables' : affectsTables.join(', ')}.`,
      keySignature: sql.split('\n').slice(0, 5).join('\n'),
      filePaths: [repoRel],
      entryPath: repoRel,
      techSubDomains: ['database', 'data-migration'],
      tags: isApplied ? ['applied'] : ['pending'],
      metadataJson: JSON.stringify(meta),
      source: 'drizzle_introspect',
      contentHash: checksum,
      extractedAtCommit: opts.extractedAtCommit,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      embeddingDim: DEFAULT_EMBEDDING_DIM,
      embeddingVersion: DEFAULT_EMBEDDING_VERSION,
      createdAt: opts.now,
      updatedAt: opts.now,
      dedupKey,
    });
    result.artifacts.push(artifact);
  }

  return result;
}

function relativize(repoRoot: string, abs: string): string {
  if (abs.startsWith(repoRoot)) {
    let rel = abs.slice(repoRoot.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return abs;
}

// Suppress unused warning in non-CommonJS contexts.
void basename;
