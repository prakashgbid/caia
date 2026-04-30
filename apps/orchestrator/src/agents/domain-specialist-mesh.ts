/**
 * Domain Specialist Mesh (EA Multi-Domain Decomposition PR 4 / EA-MESH-004).
 *
 * Stage 3 of the mesh pipeline — orchestrates the triage + specialists.
 *
 * Pipeline:
 *   1. Read TicketBundle for the story.
 *   2. Stage 1: domain-triage.ts → set of macro-domains in scope.
 *   3. Stage 2: parallel specialist invocations via Promise.all
 *      (domain-specialists.ts, one call per in-scope domain).
 *   4. Aggregate every domain's V2 instructions into the story's
 *      `architectural_instructions_json` column (V1 schema is a strict
 *      subset of V2 → backward compat at read-time).
 *   5. Append per-call telemetry (model, tokens, time, AKG hits, judge
 *      score=null) to ~/.caia/ea-mesh-telemetry-<YYYY-MM-DD>.jsonl.
 *
 * Wiring (ea-agent.ts) — gated by EA_USE_DOMAIN_MESH=1:
 *   on:  mesh becomes the primary path
 *   off: fall back to the existing ea-akg-instructor (V1 only)
 *
 * The mesh is intentionally additive: it co-exists with the V1 path, can
 * be flipped per-prompt for A/B comparison, and persists V2 instructions
 * onto the same column the V1 instructor uses (V2 is a Zod superset of V1).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import {
  StubEmbeddingClient,
  OllamaEmbeddingClient,
  type EmbeddingClient,
} from '@chiefaia/architecture-registry';
import type {
  ArchitecturalInstructionV2,
} from '@chiefaia/ticket-template';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';
import { getTicketBundle } from '../api/ticket-bundle';
import type { TicketBundle } from '../api/ticket-bundle';
import { runDomainTriageFromBundle, type MacroDomain } from './domain-triage';
import {
  runSpecialist,
  type SpecialistOpts,
  type SpecialistResult,
} from './domain-specialists';
import { advancePipelineStage } from './pipeline-stages';

// ─── Feature flag ──────────────────────────────────────────────────────────

/** Env var that switches ea-agent.ts from V1 instructor → V2 mesh. */
export const EA_USE_DOMAIN_MESH_ENV = 'EA_USE_DOMAIN_MESH';

export function isMeshEnabled(): boolean {
  const raw = process.env[EA_USE_DOMAIN_MESH_ENV];
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// ─── Telemetry ─────────────────────────────────────────────────────────────

export interface MeshTelemetryRecord {
  ts: number;
  promptId: string;
  correlationId: string;
  storyId: string;
  domain: MacroDomain;
  durationMs: number;
  akgHits: number;
  llmUsed: boolean;
  instructionsCount: number;
  /** Reserved for the judge agent in P1 — null until then. */
  judgeScore: number | null;
}

export interface TelemetrySink {
  write(record: MeshTelemetryRecord): void;
}

class JsonlFileSink implements TelemetrySink {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }
  write(record: MeshTelemetryRecord): void {
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      // Telemetry never blocks the mesh — log + drop.
      // eslint-disable-next-line no-console
      console.warn('[ea-mesh] telemetry write failed', err);
    }
  }
}

export function defaultTelemetryPath(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  // Re-strip path separators defensively even though the components are
  // derived from Date(); satisfies the path-join-resolve-traversal lint
  // and protects against any future caller passing a tainted Date proxy.
  const dateStamp = `${yyyy}-${mm}-${dd}`.replace(/[^0-9-]/g, '');
  const filename = path.basename(`ea-mesh-telemetry-${dateStamp}.jsonl`);
  return path.join(os.homedir(), '.caia', filename);
}

// ─── Embedder default (mirrors ea-akg-instructor.ts) ───────────────────────

function defaultEmbedder(): EmbeddingClient {
  if (process.env.AKG_USE_STUB_EMBEDDER === '1') {
    return new StubEmbeddingClient('stub-embed-text', 32);
  }
  return new OllamaEmbeddingClient({});
}

// ─── Drizzle → raw better-sqlite3 (mirrors ea-akg-instructor.ts) ───────────

function getRawSqliteFromDrizzle(db: Db): Database.Database {
  const session = (db as unknown as { session?: { client?: unknown } }).session;
  if (session?.client) {
    return session.client as Database.Database;
  }
  const dollar = (db as unknown as { $client?: unknown }).$client;
  if (dollar) return dollar as Database.Database;
  throw new Error(
    'domain-specialist-mesh: could not locate raw better-sqlite3 instance on drizzle wrapper',
  );
}

// ─── Mesh ──────────────────────────────────────────────────────────────────

export interface MeshDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
  telemetry?: TelemetrySink;
}

export interface MeshOpts {
  /** Override default specialist options (skipLlm, topK, etc). */
  specialistOpts?: SpecialistOpts;
  /** Force a specific domain set (skips triage). For tests + CLI overrides. */
  forceDomains?: readonly MacroDomain[];
  /** Skip the LLM pass for triage (deterministic-only). */
  triageKeywordOnly?: boolean;
}

export interface BundleMeshResult {
  /** All V2 instructions aggregated from in-scope specialists. */
  instructions: ArchitecturalInstructionV2[];
  /** Macro-domains the triage put in scope. */
  domainsRun: MacroDomain[];
  /** Per-domain raw specialist outputs. */
  perDomain: SpecialistResult[];
  /** Wall-clock for the whole mesh run. */
  durationMs: number;
}

export interface PromptMeshResult {
  promptId: string;
  storiesProcessed: number;
  storiesFailed: number;
  instructionsTotal: number;
  domainsRunTotal: number;
}

export class DomainSpecialistMesh {
  private readonly telemetry: TelemetrySink;

  constructor(private readonly deps: MeshDeps) {
    this.telemetry = deps.telemetry ?? new JsonlFileSink(defaultTelemetryPath());
  }

  /**
   * Run the mesh against a single ticket bundle. Returns the aggregated
   * V2 instructions; does NOT persist to the DB. Useful for unit tests.
   */
  async runForBundle(
    bundle: TicketBundle,
    opts: MeshOpts = {},
    correlationId = 'standalone',
  ): Promise<BundleMeshResult> {
    const t0 = Date.now();

    // Stage 1 — triage.
    let domainsToRun: MacroDomain[];
    if (opts.forceDomains && opts.forceDomains.length > 0) {
      domainsToRun = [...opts.forceDomains];
    } else {
      const triage = await runDomainTriageFromBundle(bundle, {
        keywordOnly: opts.triageKeywordOnly === true,
      });
      domainsToRun = triage.inScopeDomains;
      // If triage empties the set (shouldn't happen — keyword pass always
      // returns at least 'backend'), default to backend so the mesh still
      // produces an instruction.
      if (domainsToRun.length === 0) domainsToRun = ['backend'];
    }

    // Stage 2 — specialists in parallel.
    const specialistOpts: SpecialistOpts = opts.specialistOpts ?? {};
    const settled = await Promise.allSettled(
      domainsToRun.map((domain) =>
        runSpecialist(
          domain,
          bundle,
          { db: this.deps.db, embedder: this.deps.embedder },
          specialistOpts,
        ),
      ),
    );

    const perDomain: SpecialistResult[] = [];
    const instructions: ArchitecturalInstructionV2[] = [];

    for (let i = 0; i < settled.length; i++) {
      const domain = domainsToRun[i]!;
      const outcome = settled[i]!;
      if (outcome.status === 'fulfilled') {
        const sr = outcome.value;
        perDomain.push(sr);
        instructions.push(...sr.instructions);
        this.telemetry.write({
          ts: Date.now(),
          promptId: bundle.story.rootPromptId ?? 'unknown',
          correlationId,
          storyId: bundle.story.id,
          domain,
          durationMs: sr.durationMs,
          akgHits: sr.akgHits,
          llmUsed: sr.llmUsed,
          instructionsCount: sr.instructions.length,
          judgeScore: null,
        });
      } else {
        // Specialist threw — record telemetry + skip (don't rethrow; one
        // failing domain shouldn't halt the rest).
        // eslint-disable-next-line no-console
        console.warn(
          '[ea-mesh] specialist %s failed for story %s:',
          domain,
          bundle.story.id,
          outcome.reason,
        );
        this.telemetry.write({
          ts: Date.now(),
          promptId: bundle.story.rootPromptId ?? 'unknown',
          correlationId,
          storyId: bundle.story.id,
          domain,
          durationMs: 0,
          akgHits: 0,
          llmUsed: false,
          instructionsCount: 0,
          judgeScore: null,
        });
      }
    }

    return {
      instructions,
      domainsRun: domainsToRun,
      perDomain,
      durationMs: Date.now() - t0,
    };
  }

  /**
   * Run the mesh across all stories rooted at a given prompt and persist
   * the V2 instructions onto each story's
   * `architectural_instructions_json` column. Mirrors the surface area
   * of `runEaAkgInstructor` so ea-agent.ts can swap them.
   */
  async runForPrompt(
    input: { promptId: string; correlationId: string },
    db: Db,
    opts: MeshOpts = {},
  ): Promise<PromptMeshResult> {
    const { promptId, correlationId } = input;
    const allStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();

    let storiesProcessed = 0;
    let storiesFailed = 0;
    let instructionsTotal = 0;
    let domainsRunTotal = 0;
    const now = Date.now();

    for (const story of allStories) {
      try {
        const bundle = getTicketBundle(db, story.id);
        if (!bundle) {
          storiesFailed++;
          continue;
        }
        const result = await this.runForBundle(bundle, opts, correlationId);

        db.update(stories)
          .set({
            architecturalInstructionsJson: JSON.stringify(result.instructions),
            eaDecomposedAt: now,
          })
          .where(eq(stories.id, story.id))
          .run();

        storiesProcessed++;
        instructionsTotal += result.instructions.length;
        domainsRunTotal += result.domainsRun.length;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ea-mesh] story failed: %s', story.id, err);
        storiesFailed++;
      }
    }

    advancePipelineStage(
      {
        promptId,
        stage: 'ea_decomposed',
        correlationId,
        metadata: {
          storiesProcessed,
          storiesFailed,
          instructionsTotal,
          domainsRunTotal,
          mesh: true,
        },
      },
      db,
    );

    return {
      promptId,
      storiesProcessed,
      storiesFailed,
      instructionsTotal,
      domainsRunTotal,
    };
  }
}

// ─── Convenience entry point used by ea-agent.ts ───────────────────────────

export interface RunMeshInput {
  promptId: string;
  correlationId: string;
}

export interface RunMeshOpts {
  embedder?: EmbeddingClient;
  telemetry?: TelemetrySink;
  meshOpts?: MeshOpts;
}

/**
 * Top-level entry point used by ea-agent.ts when the EA_USE_DOMAIN_MESH
 * flag is enabled. Mirrors `runEaAkgInstructor`'s surface so the ea-agent
 * call site only changes which function it imports.
 */
export async function runDomainSpecialistMesh(
  input: RunMeshInput,
  db: Db,
  opts: RunMeshOpts = {},
): Promise<PromptMeshResult> {
  const rawDb = getRawSqliteFromDrizzle(db);
  const embedder = opts.embedder ?? defaultEmbedder();
  const mesh = new DomainSpecialistMesh({
    db: rawDb,
    embedder,
    ...(opts.telemetry ? { telemetry: opts.telemetry } : {}),
  });
  return mesh.runForPrompt(input, db, opts.meshOpts ?? {});
}
