/**
 * Langfuse-traces reader — STUB for Phase 0.
 *
 * The directive lists Langfuse traces as corpus source #4. The
 * Langfuse integration is not yet operational in CAIA today (zero
 * grep hits in packages/), so this reader ships with `enabled=false`
 * by default and returns []. When Langfuse goes online, leg 3 of the
 * Apprentice campaign will implement the real `defaultLangfuseClient`
 * against the /api/public/traces endpoint.
 *
 * The shape is fully wired up so swapping in the real client is a
 * one-import change with no API churn for downstream consumers.
 */

import type {
  LangfuseClient,
  RawArtifact,
  ReaderContext,
  SourceReader
} from './types.js';

export interface LangfuseReaderOptions {
  client: LangfuseClient;
  projectId: string;
  enabled: boolean;
}

export function createLangfuseReader(opts: LangfuseReaderOptions): SourceReader {
  return {
    source: 'langfuse',
    async read(ctx: ReaderContext): Promise<RawArtifact[]> {
      if (!opts.enabled) return [];
      const cutoffMs = ctx.nowMs - ctx.maxAgeDays * 24 * 60 * 60 * 1000;
      let records;
      try {
        records = await opts.client.listTraces(cutoffMs, opts.projectId);
      } catch {
        return [];
      }
      const out: RawArtifact[] = [];
      for (const r of records) {
        const text = formatTraceText(r.input, r.output);
        if (text === '') continue;
        out.push({
          source: 'langfuse',
          sourceId: r.id,
          kind: r.name,
          text,
          sidecar: { traceName: r.name },
          createdAtMs: r.createdAtMs
        });
      }
      return out;
    }
  };
}

export function formatTraceText(input: string, output: string): string {
  const i = (input ?? '').trim();
  const o = (output ?? '').trim();
  if (i === '' && o === '') return '';
  return `Input:\n${i}\n\nOutput:\n${o}`;
}

/** Stub — returns []. Real impl deferred to leg 3. */
export const defaultLangfuseClient: LangfuseClient = {
  async listTraces(): Promise<[]> {
    return [];
  }
};
