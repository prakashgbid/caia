/**
 * In-memory fakes for the snapshotter's three injection points: Postgres,
 * BlobStorage, and `diffDesigns`. Each is intentionally small — just enough
 * to exercise every branch of the production code paths.
 *
 * The fake Postgres parses the SQL the snapshotter emits via a regex match
 * (we own the SQL strings, so we can keep the matcher tight). Real
 * production code runs against node-postgres; the integration test covers
 * that path.
 */

import type {
  BlobStorage,
  Diff,
  DiffDesignsFn,
  PgQueryable,
  RenderableDesign,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// FakeBlobStorage
// ---------------------------------------------------------------------------

export class FakeBlobStorage implements BlobStorage {
  private readonly blobs = new Map<string, { bytes: Uint8Array; contentHash: string; storageUrl: string; contentType?: string }>();
  public putCalls = 0;
  public dedupHits = 0;
  public deleteCalls = 0;
  public urlScheme: string;
  public bucket: string;

  constructor(opts: { urlScheme?: string; bucket?: string } = {}) {
    this.urlScheme = opts.urlScheme ?? 's3';
    this.bucket = opts.bucket ?? 'caia-tenant-test';
  }

  async put(args: { path: string; bytes: Uint8Array; contentHash: string; contentType?: string }): Promise<{ storageUrl: string; deduped: boolean }> {
    this.putCalls += 1;
    const existing = this.blobs.get(args.path);
    if (existing && existing.contentHash === args.contentHash) {
      this.dedupHits += 1;
      return { storageUrl: existing.storageUrl, deduped: true };
    }
    const storageUrl = `${this.urlScheme}://${this.bucket}/${args.path}`;
    this.blobs.set(args.path, {
      bytes: args.bytes,
      contentHash: args.contentHash,
      storageUrl,
      ...(args.contentType ? { contentType: args.contentType } : {}),
    });
    return { storageUrl, deduped: false };
  }

  async head(path: string): Promise<{ exists: boolean; contentHash?: string; sizeBytes?: number }> {
    const b = this.blobs.get(path);
    if (!b) return { exists: false };
    return { exists: true, contentHash: b.contentHash, sizeBytes: b.bytes.byteLength };
  }

  async get(path: string): Promise<Uint8Array> {
    const b = this.blobs.get(path);
    if (!b) throw new Error(`blob not found: ${path}`);
    return b.bytes;
  }

  async delete(path: string): Promise<void> {
    this.deleteCalls += 1;
    this.blobs.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.blobs.keys()].filter((k) => k.startsWith(prefix));
  }

  size(): number {
    return this.blobs.size;
  }
}

// ---------------------------------------------------------------------------
// FakePg — in-memory Postgres surrogate.
//
// Maintains tables for ux_uploads / design_versions / design_assets keyed by
// (schema, tableName). Parses the queries the snapshotter emits via simple
// regex matchers. Throws on unrecognised SQL — that's a signal a new SQL
// shape was added and the fake needs updating.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface UxUploadRow {
  id: string;
  tenant_id: string;
  rendered_design: unknown;
  status: string;
}

interface DesignVersionRow {
  id: string;
  ux_upload_id: string;
  version_number: number;
  parent_version_id: string | null;
  created_at: Date;
  diff_from_parent: unknown;
  diff_summary: unknown;
  notes: string | null;
  rendered_design: unknown;
}

interface DesignAssetRow {
  id: string;
  ux_upload_id: string;
  design_version_id: string;
  path: string;
  kind: string;
  content_hash: string;
  storage_url: string;
  size_bytes: number;
  alt_text: string | null;
  intrinsic_w: number | null;
  intrinsic_h: number | null;
  is_placeholder: boolean;
}

export class FakePg implements PgQueryable {
  public uxUploads = new Map<string, UxUploadRow>();
  public designVersions: DesignVersionRow[] = [];
  public designAssets: DesignAssetRow[] = [];
  public txDepth = 0;
  public committedAt = 0;
  public rolledBack = 0;
  public queriesSeen: string[] = [];
  /** When true, the next non-control query throws. Used to test rollback. */
  public failNextQuery: Error | null = null;
  /** Fail on the next INSERT statement (post-BEGIN). Used for rollback tests. */
  public failNextInsert: Error | null = null;

  // Per-spec test seeding helper. Lets each test set up an upload row in one
  // line rather than constructing the SQL inline.
  seedUxUpload(row: Partial<UxUploadRow> & { id: string; tenant_id: string }): void {
    this.uxUploads.set(row.id, {
      id: row.id,
      tenant_id: row.tenant_id,
      rendered_design: row.rendered_design ?? null,
      status: row.status ?? 'parsing',
    });
  }

  async query<R = any>(text: string, params: ReadonlyArray<unknown> = []): Promise<{ rows: R[]; rowCount: number | null }> {
    this.queriesSeen.push(text);
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    // Tx controls — never throw, never count toward failNextQuery.
    if (upper === 'BEGIN') {
      this.txDepth += 1;
      return { rows: [], rowCount: null };
    }
    if (upper === 'COMMIT') {
      this.txDepth = Math.max(0, this.txDepth - 1);
      this.committedAt += 1;
      return { rows: [], rowCount: null };
    }
    if (upper === 'ROLLBACK') {
      this.txDepth = Math.max(0, this.txDepth - 1);
      this.rolledBack += 1;
      return { rows: [], rowCount: null };
    }

    if (this.failNextQuery) {
      const err = this.failNextQuery;
      this.failNextQuery = null;
      throw err;
    }
    if (this.failNextInsert && upper.startsWith('INSERT')) {
      const err = this.failNextInsert;
      this.failNextInsert = null;
      throw err;
    }

    // SELECT id, version_number, rendered_design FROM ...design_versions WHERE ux_upload_id=$1 ORDER BY version_number DESC LIMIT 1
    if (/SELECT id, version_number, rendered_design[\s\S]*FROM[\s\S]*"design_versions"[\s\S]*ORDER BY version_number DESC[\s\S]*LIMIT 1/i.test(text)) {
      const uxUploadId = String(params[0]);
      const candidates = this.designVersions
        .filter((r) => r.ux_upload_id === uxUploadId)
        .sort((a, b) => b.version_number - a.version_number);
      const row = candidates[0];
      return { rows: row ? ([{ id: row.id, version_number: row.version_number, rendered_design: row.rendered_design }] as R[]) : [], rowCount: row ? 1 : 0 };
    }

    // SELECT id, rendered_design FROM ...design_versions WHERE ux_upload_id=$1 AND version_number=$2 LIMIT 1
    if (/SELECT id, rendered_design[\s\S]*FROM[\s\S]*"design_versions"[\s\S]*WHERE ux_upload_id = \$1 AND version_number = \$2/i.test(text)) {
      const uxUploadId = String(params[0]);
      const versionNumber = Number(params[1]);
      const row = this.designVersions.find((r) => r.ux_upload_id === uxUploadId && r.version_number === versionNumber);
      return { rows: row ? ([{ id: row.id, rendered_design: row.rendered_design }] as R[]) : [], rowCount: row ? 1 : 0 };
    }

    // SELECT rendered_design FROM ...design_versions WHERE id=$1 LIMIT 1
    if (/SELECT rendered_design[\s\S]*FROM[\s\S]*"design_versions"[\s\S]*WHERE id = \$1[\s\S]*LIMIT 1/i.test(text)) {
      const id = String(params[0]);
      const row = this.designVersions.find((r) => r.id === id);
      return { rows: row ? ([{ rendered_design: row.rendered_design }] as R[]) : [], rowCount: row ? 1 : 0 };
    }

    // SELECT id, version_number, parent_version_id, created_at, diff_summary, notes FROM ... ORDER BY version_number DESC
    if (/SELECT id, version_number, parent_version_id, created_at, diff_summary, notes/i.test(text)) {
      const uxUploadId = String(params[0]);
      const rows = this.designVersions
        .filter((r) => r.ux_upload_id === uxUploadId)
        .sort((a, b) => b.version_number - a.version_number)
        .map((r) => ({
          id: r.id,
          version_number: r.version_number,
          parent_version_id: r.parent_version_id,
          created_at: r.created_at,
          diff_summary: r.diff_summary,
          notes: r.notes,
        }));
      return { rows: rows as R[], rowCount: rows.length };
    }

    // SELECT id, parent_version_id, diff_from_parent, rendered_design FROM ... WHERE id=$1
    if (/SELECT id, parent_version_id, diff_from_parent, rendered_design/i.test(text)) {
      const id = String(params[0]);
      const row = this.designVersions.find((r) => r.id === id);
      return { rows: row ? ([{
        id: row.id,
        parent_version_id: row.parent_version_id,
        diff_from_parent: row.diff_from_parent,
        rendered_design: row.rendered_design,
      }] as R[]) : [], rowCount: row ? 1 : 0 };
    }

    // SELECT id FROM ...ux_uploads WHERE tenant_id=$1
    if (/SELECT id FROM[\s\S]*"ux_uploads"[\s\S]*WHERE tenant_id = \$1/i.test(text)) {
      const tenantId = String(params[0]);
      const rows = [...this.uxUploads.values()]
        .filter((u) => u.tenant_id === tenantId)
        .map((u) => ({ id: u.id }));
      return { rows: rows as R[], rowCount: rows.length };
    }

    // SELECT DISTINCT storage_url FROM ...design_assets WHERE ux_upload_id = ANY($1::uuid[])
    if (/SELECT DISTINCT storage_url/i.test(text)) {
      const ids = (params[0] as string[]) ?? [];
      const set = new Set<string>();
      for (const a of this.designAssets) {
        if (ids.includes(a.ux_upload_id)) set.add(a.storage_url);
      }
      return { rows: [...set].map((s) => ({ storage_url: s })) as R[], rowCount: set.size };
    }

    // INSERT INTO ...design_versions
    if (/INSERT INTO[\s\S]*"design_versions"/i.test(text)) {
      const [id, uxUploadId, versionNumber, parentVersionId, createdAt, diffFromParent, diffSummary, notes, renderedDesign] = params;
      this.designVersions.push({
        id: String(id),
        ux_upload_id: String(uxUploadId),
        version_number: Number(versionNumber),
        parent_version_id: parentVersionId == null ? null : String(parentVersionId),
        created_at: createdAt as Date,
        diff_from_parent: diffFromParent,
        diff_summary: diffSummary,
        notes: notes == null ? null : String(notes),
        rendered_design: renderedDesign,
      });
      return { rows: [] as R[], rowCount: 1 };
    }

    // INSERT INTO ...design_assets
    if (/INSERT INTO[\s\S]*"design_assets"/i.test(text)) {
      const [id, uxUploadId, designVersionId, path, kind, contentHash, storageUrl, sizeBytes, altText, intrinsicW, intrinsicH, isPlaceholder] = params;
      const dvId = String(designVersionId);
      const p = String(path);
      // ON CONFLICT DO NOTHING — skip duplicates.
      const dup = this.designAssets.find((a) => a.design_version_id === dvId && a.path === p);
      if (dup) return { rows: [] as R[], rowCount: 0 };
      this.designAssets.push({
        id: String(id),
        ux_upload_id: String(uxUploadId),
        design_version_id: dvId,
        path: p,
        kind: String(kind),
        content_hash: String(contentHash),
        storage_url: String(storageUrl),
        size_bytes: Number(sizeBytes),
        alt_text: altText == null ? null : String(altText),
        intrinsic_w: intrinsicW == null ? null : Number(intrinsicW),
        intrinsic_h: intrinsicH == null ? null : Number(intrinsicH),
        is_placeholder: Boolean(isPlaceholder),
      });
      return { rows: [] as R[], rowCount: 1 };
    }

    // UPDATE ...ux_uploads SET rendered_design=$1, status='parsed' WHERE id=$2
    if (/UPDATE[\s\S]*"ux_uploads"[\s\S]*SET rendered_design/i.test(text)) {
      const [renderedDesign, id] = params;
      const row = this.uxUploads.get(String(id));
      if (row) {
        row.rendered_design = renderedDesign;
        row.status = 'parsed';
      }
      return { rows: [] as R[], rowCount: row ? 1 : 0 };
    }

    // DELETE FROM ...design_versions WHERE ux_upload_id = ANY($1::uuid[])
    if (/DELETE FROM[\s\S]*"design_versions"/i.test(text)) {
      const ids = (params[0] as string[]) ?? [];
      const before = this.designVersions.length;
      this.designVersions = this.designVersions.filter((r) => !ids.includes(r.ux_upload_id));
      return { rows: [] as R[], rowCount: before - this.designVersions.length };
    }

    // DELETE FROM ...design_assets WHERE ux_upload_id = ANY($1::uuid[])
    if (/DELETE FROM[\s\S]*"design_assets"/i.test(text)) {
      const ids = (params[0] as string[]) ?? [];
      const before = this.designAssets.length;
      this.designAssets = this.designAssets.filter((r) => !ids.includes(r.ux_upload_id));
      return { rows: [] as R[], rowCount: before - this.designAssets.length };
    }

    // DELETE FROM ...ux_uploads WHERE id = ANY($1::uuid[])
    if (/DELETE FROM[\s\S]*"ux_uploads"/i.test(text)) {
      const ids = (params[0] as string[]) ?? [];
      let removed = 0;
      for (const id of ids) {
        if (this.uxUploads.delete(id)) removed += 1;
      }
      return { rows: [] as R[], rowCount: removed };
    }

    throw new Error(`FakePg: unrecognised query:\n${text}`);
  }
}

// ---------------------------------------------------------------------------
// fakeDiff — deterministic, structural diff over componentTrees.
//
// Mirrors the documented atlas-mapper shape: { added, removed, modified[] }.
// Production code injects the real atlas-mapper.diffDesigns; tests use this
// stand-in so we don't depend on atlas-mapper's source being finished.
// ---------------------------------------------------------------------------

export const fakeDiff: DiffDesignsFn = (parent, child) => {
  const parentIds = collectDomIds(parent);
  const childIds = collectDomIds(child);

  const added: Diff['added'] = [];
  const removed: Diff['removed'] = [];
  const modified: Diff['modified'] = [];

  for (const [id, node] of childIds) {
    if (!parentIds.has(id)) {
      added.push({ domId: id, tag: node.tag, role: node.role });
    }
  }
  for (const [id, node] of parentIds) {
    if (!childIds.has(id)) {
      removed.push({ domId: id, tag: node.tag, role: node.role });
    } else {
      const after = childIds.get(id)!;
      const reasons: Diff['modified'][number]['reasons'] = [];
      if (JSON.stringify(node.attrs ?? {}) !== JSON.stringify(after.attrs ?? {})) {
        reasons.push('attrs_changed');
      }
      if (reasons.length > 0) {
        modified.push({ domId: id, reasons, before: { domId: id, tag: node.tag }, after: { domId: id, tag: after.tag } });
      }
    }
  }
  return { added, removed, modified };
};

function collectDomIds(d: RenderableDesign): Map<string, { tag: string; role: any; attrs?: any }> {
  const out = new Map<string, { tag: string; role: any; attrs?: any }>();
  for (const tree of Object.values(d.componentTrees ?? {})) {
    walk(tree.node, out);
  }
  return out;
}

function walk(node: any, out: Map<string, { tag: string; role: any; attrs?: any }>): void {
  if (node?.domId) {
    out.set(node.domId, { tag: node.tag, role: node.role, attrs: node.attrs });
  }
  for (const c of node?.children ?? []) walk(c, out);
}

// ---------------------------------------------------------------------------
// Sample-payload builders
// ---------------------------------------------------------------------------

export function makeDesign(overrides: Partial<RenderableDesign> = {}): RenderableDesign {
  return {
    source: 'cd-zip',
    routes: [{ path: '/', componentTreeId: 'home' }],
    componentTrees: {
      home: {
        rootDomId: 'page-home',
        node: {
          domId: 'page-home',
          tag: 'main',
          role: 'page',
          children: [
            {
              domId: 'page-home>section-hero',
              tag: 'section',
              role: 'section',
              children: [
                {
                  domId: 'page-home>section-hero>widget-headline',
                  tag: 'h1',
                  role: 'widget',
                  attrs: { className: 'text-3xl' },
                },
              ],
            },
          ],
        },
      },
    },
    designTokens: { colors: { '--brand': '#222' } },
    assets: [],
    copy: [],
    interactivity: [],
    ...overrides,
  };
}

export function makeAssetBytes(seed: string): Uint8Array {
  // Deterministic bytes so SHA matches across tests.
  const out = new Uint8Array(32);
  for (let i = 0; i < seed.length && i < 32; i++) out[i] = seed.charCodeAt(i);
  return out;
}

/** Deterministic id generator — yields 'id-1', 'id-2', ... */
export function counterIdGen(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

/** Frozen clock — always returns the same Date instance. */
export function frozenClock(at: string = '2026-05-23T00:00:00Z'): () => Date {
  const d = new Date(at);
  return () => d;
}
