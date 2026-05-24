/**
 * @caia/pipeline-conductor — forecaster.ts
 * Statistical (not ML) p50/p90 from conductor_stage_durations. Spec §9.
 */

import type { Pool } from 'pg';
import { STAGE_NAMES } from './types.js';
import type { ProjectForecast, StageName } from './types.js';

export interface StageForecast {
  stage: StageName;
  p50Seconds: number;
  p90Seconds: number;
  sampleSize: number;
  source: 'tenant-stat' | 'platform-fallback' | 'insufficient-data';
}

export interface ForecasterOptions {
  minTenantSamples?: number;
  minPlatformSamples?: number;
  windowDays?: number;
  now?: () => Date;
}

const DEFAULT_OPTIONS: Required<ForecasterOptions> = {
  minTenantSamples: 10,
  minPlatformSamples: 10,
  windowDays: 30,
  now: () => new Date(),
};

export class Forecaster {
  private readonly opts: Required<ForecasterOptions>;

  constructor(
    private readonly pool: Pool,
    opts: ForecasterOptions = {},
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  async stageForecast(tenantId: string, stage: StageName): Promise<StageForecast> {
    const tenant = await this.queryStageStats(stage, tenantId);
    if (tenant.sampleSize >= this.opts.minTenantSamples) {
      return { ...tenant, stage, source: 'tenant-stat' };
    }
    const platform = await this.queryStageStats(stage, null);
    if (platform.sampleSize >= this.opts.minPlatformSamples) {
      return { ...platform, stage, source: 'platform-fallback' };
    }
    return {
      stage,
      p50Seconds: 0,
      p90Seconds: 0,
      sampleSize: platform.sampleSize,
      source: 'insufficient-data',
    };
  }

  async forecastProject(input: {
    tenantId: string;
    currentStage: StageName;
  }): Promise<ProjectForecast> {
    const remainingStages = stagesAfter(input.currentStage);
    if (remainingStages.length === 0) {
      const now = this.opts.now().toISOString();
      return { p50At: now, p90At: now, sampleSize: 0, source: 'tenant-stat' };
    }

    const forecasts = await Promise.all(
      remainingStages.map((s) => this.stageForecast(input.tenantId, s)),
    );

    const hasInsufficient = forecasts.some((f) => f.source === 'insufficient-data');
    if (hasInsufficient) {
      return { p50At: null, p90At: null, sampleSize: 0, source: 'insufficient-data' };
    }

    const p50Sec = forecasts.reduce((sum, f) => sum + f.p50Seconds, 0);
    const p90Sec = forecasts.reduce((sum, f) => sum + f.p90Seconds, 0);
    const minSampleSize = Math.min(...forecasts.map((f) => f.sampleSize));
    const source: ProjectForecast['source'] = forecasts.some(
      (f) => f.source === 'platform-fallback',
    )
      ? 'platform-fallback'
      : 'tenant-stat';

    const nowMs = this.opts.now().getTime();
    return {
      p50At: new Date(nowMs + p50Sec * 1000).toISOString(),
      p90At: new Date(nowMs + p90Sec * 1000).toISOString(),
      sampleSize: minSampleSize,
      source,
    };
  }

  static confidenceLabel(sampleSize: number): string {
    if (sampleSize >= 200) return 'Reliable estimate';
    if (sampleSize >= 50) return 'Decent estimate';
    if (sampleSize >= 10) return 'Rough estimate';
    return "We're estimating this one as we go.";
  }

  private async queryStageStats(
    stage: StageName,
    tenantId: string | null,
  ): Promise<{ p50Seconds: number; p90Seconds: number; sampleSize: number }> {
    const params: unknown[] = [stage, String(this.opts.windowDays)];
    let where = `stage = $1
        AND entered_at > now() - ($2::text || ' days')::interval
        AND exit_reason = 'succeeded'`;
    if (tenantId !== null) {
      params.push(tenantId);
      where += ` AND tenant_id = $3`;
    }
    const sql = `
      SELECT
        coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds), 0)::FLOAT AS p50,
        coalesce(percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_seconds), 0)::FLOAT AS p90,
        count(*)::INT AS sample_size
      FROM caia_meta.conductor_stage_durations
      WHERE ${where}
    `;
    const res = await this.pool.query<{ p50: number; p90: number; sample_size: number }>(
      sql,
      params,
    );
    const row = res.rows[0];
    return {
      p50Seconds: row ? Math.round(row.p50) : 0,
      p90Seconds: row ? Math.round(row.p90) : 0,
      sampleSize: row ? row.sample_size : 0,
    };
  }
}

export function computeStageForecastFromSamples(
  samples: number[],
): { p50: number; p90: number; sampleSize: number } {
  if (samples.length === 0) return { p50: 0, p90: 0, sampleSize: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    sampleSize: sorted.length,
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = p * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

export function stagesAfter(stage: StageName): StageName[] {
  const idx = STAGE_NAMES.indexOf(stage);
  if (idx < 0) return [];
  return STAGE_NAMES.slice(idx + 1) as StageName[];
}
