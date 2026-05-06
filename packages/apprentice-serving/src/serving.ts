/**
 * ApprenticeServing — top-level orchestrator. Composes:
 *   - AdapterRegistry  (state book-keeping)
 *   - OllamaClient     (subprocess: ollama create/rm/show/list)
 *   - CanaryRouter     (canary-routing.json writer)
 *   - metadata-reader  (training-metadata.json + eval-report.json)
 *
 * Each public method threads metadata-read → registry-mutation → ollama-side-effect →
 * canary-config-write so callers see one atomic-feeling operation.
 */

import * as path from 'node:path';
import {
  AdapterNotFoundError,
  RegistryStateMismatchError
} from './types.js';
import type {
  ApprenticeServingConfig,
  CanaryRoutingCanaryEntry,
  CanaryRoutingProductionEntry,
  EvalSummary,
  OllamaClient,
  RegistryEntry,
  RegistryStatus,
  ResolvedServingConfig
} from './types.js';
import { AdapterRegistry } from './adapter-registry.js';
import { CanaryRouter } from './canary-router.js';
import { resolveServingConfig, baseShortName } from './config.js';
import { readAdapterArtifacts } from './metadata-reader.js';
import { SubprocessOllamaClient } from './ollama-client.js';

export class ApprenticeServing {
  private readonly cfg: ResolvedServingConfig;
  public readonly registry: AdapterRegistry;
  public readonly canaryRouter: CanaryRouter;
  private readonly ollama: OllamaClient;

  constructor(config: ApprenticeServingConfig = {}) {
    this.cfg = resolveServingConfig(config);
    this.registry = new AdapterRegistry({
      registryPath: this.cfg.registryPath,
      fs: this.cfg.fs,
      clock: this.cfg.clock
    });
    this.canaryRouter = new CanaryRouter({
      canaryRoutingConfigPath: this.cfg.canaryRoutingConfigPath,
      fs: this.cfg.fs,
      clock: this.cfg.clock
    });
    this.ollama =
      this.cfg.ollamaClient ??
      new SubprocessOllamaClient({
        ollamaBinaryPath: this.cfg.ollamaBinaryPath,
        ...(this.cfg.ollamaHost !== undefined ? { ollamaHost: this.cfg.ollamaHost } : {}),
        timeoutMs: this.cfg.ollamaTimeoutMs
      });
  }

  /**
   * Idempotent: reads training-metadata.json from the adapter dir, derives
   * the adapterName (= directory basename), upserts a `registered` entry.
   * Returns the resulting registry entry.
   */
  async register(adapterPath: string): Promise<RegistryEntry> {
    const artifacts = readAdapterArtifacts(this.cfg.fs, adapterPath);
    const adapterName = path.basename(adapterPath);
    const existing = this.registry.getByName(adapterName);

    if (existing !== undefined) {
      // Idempotent: same adapter, no state change. Refresh metadata fields
      // (path can change if user moves the dir, eval can land later).
      const refreshed: RegistryEntry = {
        ...existing,
        adapterPath,
        metadataSha256: artifacts.metadataSha256,
        baseModel: artifacts.metadata.baseModel,
        baseModelOllamaTag: artifacts.metadata.baseModelOllamaTag,
        configSha256: artifacts.metadata.configSha256
      };
      if (artifacts.evalReport !== undefined) refreshed.evalReport = artifacts.evalReport;
      this.registry.upsert(refreshed);
      return refreshed;
    }

    const entry: RegistryEntry = {
      adapterName,
      adapterPath,
      metadataSha256: artifacts.metadataSha256,
      configSha256: artifacts.metadata.configSha256,
      baseModel: artifacts.metadata.baseModel,
      baseModelOllamaTag: artifacts.metadata.baseModelOllamaTag,
      status: 'registered',
      history: [
        {
          at: this.cfg.clock().toISOString(),
          fromStatus: null,
          toStatus: 'registered'
        }
      ],
      registeredAt: this.cfg.clock().toISOString()
    };
    if (artifacts.evalReport !== undefined) entry.evalReport = artifacts.evalReport;
    this.registry.upsert(entry);
    return entry;
  }

  /**
   * Load the adapter into Ollama as `<base>-canary-<sha7>`, transition
   * to canary, atomically update canary-routing config.
   */
  async promoteToCanary(adapterPath: string, percent: number): Promise<RegistryEntry> {
    AdapterRegistry.assertCanaryPercent(percent);
    const entry = await this.requireRegistered(adapterPath);
    AdapterRegistry.assertValidTransition(entry.status, 'canary');

    // If another canary exists for a DIFFERENT adapter, archive it first.
    const prevCanary = this.registry.currentCanary();
    if (prevCanary !== undefined && prevCanary.adapterName !== entry.adapterName) {
      await this.archiveCanary(prevCanary);
    }

    const artifacts = readAdapterArtifacts(this.cfg.fs, entry.adapterPath);
    const sha7 = entry.metadataSha256.slice(0, 7);
    const base = baseShortName(entry.baseModelOllamaTag);
    const canaryModelName = this.cfg.canaryModelName(base, sha7);

    await this.ollama.create({
      modelName: canaryModelName,
      modelfilePath: artifacts.modelfilePath,
      cwd: entry.adapterPath
    });

    const updated = this.registry.transition(
      entry.adapterName,
      'canary',
      (e) => {
        e.ollamaModelName = canaryModelName;
        e.canaryPercent = percent;
        e.promotedAt = this.cfg.clock().toISOString();
      },
      `promoted to canary @${percent}%`
    );
    this.writeCanaryRouting();
    return updated;
  }

  /**
   * Load the adapter into Ollama as `<base>-production`, transition to
   * production, archive the previous production (if any).
   */
  async promoteToProduction(adapterPath: string): Promise<RegistryEntry> {
    const entry = await this.requireRegistered(adapterPath);
    AdapterRegistry.assertValidTransition(entry.status, 'production');

    const artifacts = readAdapterArtifacts(this.cfg.fs, entry.adapterPath);
    const base = baseShortName(entry.baseModelOllamaTag);
    const prodModelName = this.cfg.productionModelName(base);

    // Archive previous production (if any) BEFORE overwriting the slot.
    const prevProd = this.registry.currentProduction();
    if (prevProd !== undefined && prevProd.adapterName !== entry.adapterName) {
      await this.archiveProduction(prevProd);
    }

    await this.ollama.create({
      modelName: prodModelName,
      modelfilePath: artifacts.modelfilePath,
      cwd: entry.adapterPath
    });

    // If THIS adapter was the previous canary, the canary Ollama model is
    // now stale. Best-effort remove.
    if (entry.status === 'canary' && entry.ollamaModelName !== undefined) {
      const staleCanary = entry.ollamaModelName;
      try {
        await this.ollama.remove(staleCanary);
      } catch {
        /* best-effort */
      }
    }

    const updated = this.registry.transition(
      entry.adapterName,
      'production',
      (e) => {
        e.ollamaModelName = prodModelName;
        e.promotedAt = this.cfg.clock().toISOString();
      },
      'promoted to production'
    );
    this.writeCanaryRouting();
    this.gcArchived();
    return updated;
  }

  /**
   * Roll back to a previously-archived adapter. Re-promotes it to
   * production; archives the current production.
   */
  async rollback(toAdapterPath: string): Promise<RegistryEntry> {
    const target = this.registry.getByName(path.basename(toAdapterPath));
    if (target === undefined) {
      throw new AdapterNotFoundError(`rollback target not in registry: ${toAdapterPath}`, {
        toAdapterPath
      });
    }
    AdapterRegistry.assertRollbackTarget(target);

    const artifacts = readAdapterArtifacts(this.cfg.fs, target.adapterPath);
    const base = baseShortName(target.baseModelOllamaTag);
    const prodModelName = this.cfg.productionModelName(base);

    const prevProd = this.registry.currentProduction();
    if (prevProd !== undefined && prevProd.adapterName !== target.adapterName) {
      await this.archiveProduction(prevProd);
    }

    await this.ollama.create({
      modelName: prodModelName,
      modelfilePath: artifacts.modelfilePath,
      cwd: target.adapterPath
    });

    const updated = this.registry.transition(
      target.adapterName,
      'production',
      (e) => {
        e.ollamaModelName = prodModelName;
        e.promotedAt = this.cfg.clock().toISOString();
      },
      'rolled back to production'
    );
    this.writeCanaryRouting();
    this.gcArchived();
    return updated;
  }

  /**
   * Mark an adapter rejected. Removes it from Ollama if loaded.
   */
  async reject(adapterPath: string, reason: string): Promise<RegistryEntry> {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new RegistryStateMismatchError('reject() requires a non-empty reason', {
        adapterPath
      });
    }
    const entry = await this.requireRegistered(adapterPath);
    AdapterRegistry.assertValidTransition(entry.status, 'rejected');

    if (entry.ollamaModelName !== undefined) {
      try {
        await this.ollama.remove(entry.ollamaModelName);
      } catch {
        /* best-effort */
      }
    }

    const updated = this.registry.transition(
      entry.adapterName,
      'rejected',
      (e) => {
        e.rejectionReason = reason;
        delete e.ollamaModelName;
      },
      `rejected: ${reason}`
    );
    this.writeCanaryRouting();
    return updated;
  }

  /** Read-through helpers. */
  list(): RegistryEntry[] {
    return this.registry.list();
  }
  currentProduction(): RegistryEntry | undefined {
    return this.registry.currentProduction();
  }
  currentCanary(): RegistryEntry | undefined {
    return this.registry.currentCanary();
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /** Ensure the adapter is registered; throws if not. */
  private async requireRegistered(adapterPath: string): Promise<RegistryEntry> {
    const adapterName = path.basename(adapterPath);
    const existing = this.registry.getByName(adapterName);
    if (existing !== undefined) {
      // Refresh adapterPath and eval metadata in case the dir moved or eval
      // landed since registration.
      if (existing.adapterPath !== adapterPath) {
        existing.adapterPath = adapterPath;
        this.registry.upsert(existing);
      }
      return existing;
    }
    return this.register(adapterPath);
  }

  /** Re-write canary-routing.json from current registry state. */
  private writeCanaryRouting(): void {
    const prod = this.registry.currentProduction();
    const canary = this.registry.currentCanary();
    const productionEntry: CanaryRoutingProductionEntry | null =
      prod && prod.ollamaModelName
        ? { ollamaModelName: prod.ollamaModelName, adapterName: prod.adapterName }
        : null;
    const canaryEntry: CanaryRoutingCanaryEntry | null =
      canary && canary.ollamaModelName && canary.canaryPercent !== undefined
        ? {
            ollamaModelName: canary.ollamaModelName,
            adapterName: canary.adapterName,
            percent: canary.canaryPercent
          }
        : null;
    this.canaryRouter.write({ production: productionEntry, canary: canaryEntry });
  }

  /** Move a previous-production entry to archived; remove its Ollama model. */
  private async archiveProduction(entry: RegistryEntry): Promise<void> {
    if (entry.ollamaModelName !== undefined) {
      try {
        await this.ollama.remove(entry.ollamaModelName);
      } catch {
        /* best-effort */
      }
    }
    this.registry.transition(
      entry.adapterName,
      'archived',
      (e) => {
        e.archivedAt = this.cfg.clock().toISOString();
        delete e.ollamaModelName;
      },
      'archived (replaced by newer production)'
    );
  }

  /** Move a previous-canary entry to archived; remove its Ollama model. */
  private async archiveCanary(entry: RegistryEntry): Promise<void> {
    if (entry.ollamaModelName !== undefined) {
      try {
        await this.ollama.remove(entry.ollamaModelName);
      } catch {
        /* best-effort */
      }
    }
    this.registry.transition(
      entry.adapterName,
      'archived',
      (e) => {
        e.archivedAt = this.cfg.clock().toISOString();
        delete e.ollamaModelName;
      },
      'archived (replaced by newer canary)'
    );
  }

  /** GC oldest archived entries beyond the keep-cap. */
  private gcArchived(): void {
    const archived = this.registry
      .list()
      .filter((e) => e.status === 'archived')
      .sort((a, b) => (a.archivedAt ?? '').localeCompare(b.archivedAt ?? ''));
    while (archived.length > this.cfg.maxArchivedToKeep) {
      const oldest = archived.shift();
      if (oldest === undefined) break;
      this.registry.drop(oldest.adapterName);
    }
  }
}

// Re-export the relevant status type for convenience.
export type { RegistryStatus, EvalSummary };
