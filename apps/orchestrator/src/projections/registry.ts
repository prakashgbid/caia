/**
 * ProjectionRegistry — PROJ-001
 *
 * Central manager for all named projections. Callers register definitions,
 * then call startAll(db) once (typically at orchestrator boot, after wirePhase2).
 *
 * Usage:
 *   projectionRegistry.register({ name: 'my-read-model', ... });
 *   const { stopAll } = projectionRegistry.startAll(db);  // at startup
 *   stopAll();  // at shutdown
 */

import type { Db } from '../db/connection';
import { ProjectionRunner } from './runner';
import type { ProjectionDefinition, ProjectionStatus } from './types';

export class ProjectionRegistry {
  private readonly runners = new Map<string, ProjectionRunner>();

  /**
   * Register a projection definition. Safe to call before startAll().
   * Throws if a projection with the same name is already registered.
   */
  register(def: ProjectionDefinition): void {
    if (this.runners.has(def.name)) {
      throw new Error(`Projection "${def.name}" is already registered`);
    }
    this.runners.set(def.name, new ProjectionRunner(def));
  }

  /**
   * Start all registered projections (catchup + live subscribe).
   * Returns a stopAll() that unsubscribes every runner.
   */
  startAll(db: Db): { stopAll: () => void } {
    const starts = Array.from(this.runners.values()).map(r => r.start(db));
    // Fire-and-forget: catchup is async but subscribe happens inside.
    Promise.all(starts).catch(err => {
      console.error('[projection-registry] startAll error:', err);
    });

    let stopped = false;
    return {
      stopAll: () => {
        if (stopped) return;
        stopped = true;
        for (const runner of this.runners.values()) {
          try { runner.stop(); } catch { /* ignore */ }
        }
      },
    };
  }

  /** Health snapshot for the /projections endpoint. */
  status(db: Db): ProjectionStatus[] {
    return Array.from(this.runners.values()).map(r => ({
      name: r.name,
      checkpoint: r.getCheckpoint(db),
      live: r.live,
    }));
  }

  /** Return names of all registered projections. */
  names(): string[] {
    return Array.from(this.runners.keys());
  }
}

export const projectionRegistry = new ProjectionRegistry();
