/**
 * Relevance filter — LLM-driven judge over each SearchResult. Returns
 * a verdict {relevant, confidence, reason, recommendation}.
 *
 * Production wires this to @chiefaia/claude-spawner (subscription only).
 * Tests inject a StubRelevanceCritic returning canned verdicts.
 *
 * Per-item try/catch — a judgment failure on one item does NOT abort
 * the scan; the item is logged as a 'judge-error' and skipped.
 */
import type {
  JudgedItem,
  RelevanceCritic,
  RelevanceVerdict,
  ScanError,
  SearchResult,
} from './types.js';

/** Default critic that judges nothing as relevant — safe fallback. */
export class NullRelevanceCritic implements RelevanceCritic {
  async judge(_item: SearchResult): Promise<RelevanceVerdict> {
    return { relevant: false, confidence: 0, reason: 'no critic wired', recommendation: 'wire critic' };
  }
}

/** Test critic that returns a canned verdict by item URL. */
export class StubRelevanceCritic implements RelevanceCritic {
  constructor(private readonly verdicts: Record<string, RelevanceVerdict>) {}

  async judge(item: SearchResult): Promise<RelevanceVerdict> {
    return this.verdicts[item.url] ?? { relevant: false, confidence: 0, reason: 'no canned verdict', recommendation: '' };
  }
}

export interface FilterInput {
  items: SearchResult[];
  critic: RelevanceCritic;
  confidenceThreshold: number;
}

export interface FilterResult {
  judged: JudgedItem[];
  relevant: JudgedItem[];
  errors: ScanError[];
}

export async function filterItems(input: FilterInput): Promise<FilterResult> {
  const judged: JudgedItem[] = [];
  const relevant: JudgedItem[] = [];
  const errors: ScanError[] = [];
  for (const item of input.items) {
    try {
      const verdict = await input.critic.judge(item);
      const j = { item, verdict };
      judged.push(j);
      if (verdict.relevant && verdict.confidence >= input.confidenceThreshold) {
        relevant.push(j);
      }
    } catch (err) {
      errors.push({
        kind: 'judge-error',
        sourceId: item.sourceId,
        itemUrl: item.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { judged, relevant, errors };
}
