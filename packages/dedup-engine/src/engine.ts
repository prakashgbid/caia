import { jaccardSimilarity, labelOverlapScore, combinedScore } from './similarity';
import type { DedupCandidate, DedupResult, DedupEngineConfig, SimilarItem, DedupDecision } from './types';

const DEFAULTS: Required<DedupEngineConfig> = {
  duplicateThreshold: 0.92,
  likelyDuplicateThreshold: 0.80,
  overlapThreshold: 0.65,
  relatedThreshold: 0.50,
  temporalDecayDays: 180,
  projectScoped: true,
};

function applyTemporalDecay(score: number, candidate: DedupCandidate, decayDays: number): number {
  if (!candidate.createdAt) return score;
  const ageMs = Date.now() - candidate.createdAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < decayDays) return score;
  // After decay threshold, reduce score linearly to 50% at 2x decay period
  const decayFactor = Math.max(0.5, 1 - ((ageDays - decayDays) / decayDays) * 0.5);
  return score * decayFactor;
}

export function check(
  newItem: DedupCandidate,
  corpus: DedupCandidate[],
  config: DedupEngineConfig = {}
): DedupResult {
  const cfg = { ...DEFAULTS, ...config };
  const newText = `${newItem.title} ${newItem.description ?? ''}`.trim();

  // Score all corpus items
  const scored: Array<{ item: DedupCandidate; score: number }> = corpus
    .filter(c => c.id !== newItem.id)
    .map(candidate => {
      const candidateText = `${candidate.title} ${candidate.description ?? ''}`.trim();
      const textSim = jaccardSimilarity(newText, candidateText);
      // Only blend in label overlap when at least one side has labels;
      // otherwise a pure-text comparison would be unfairly capped at 0.7
      const hasLabels = (newItem.labels?.length ?? 0) > 0 || (candidate.labels?.length ?? 0) > 0;
      const rawScore = hasLabels
        ? combinedScore(textSim, labelOverlapScore(newItem.labels ?? [], candidate.labels ?? []))
        : textSim;
      const finalScore = applyTemporalDecay(rawScore, candidate, cfg.temporalDecayDays);
      return { item: candidate, score: finalScore };
    })
    .filter(s => s.score >= cfg.relatedThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);  // top 10 matches

  const topScore = scored[0]?.score ?? 0;

  // Determine decision
  let decision: DedupDecision = 'new';
  if (topScore >= cfg.duplicateThreshold) decision = 'duplicate';
  else if (topScore >= cfg.likelyDuplicateThreshold) decision = 'likely_duplicate';
  else if (topScore >= cfg.overlapThreshold) decision = 'overlap';
  else if (topScore >= cfg.relatedThreshold) decision = 'related';
  else if (scored.length > 0) decision = 'similar_concept';

  const similarItems: SimilarItem[] = scored.map(s => ({
    id: s.item.id,
    title: s.item.title,
    description: s.item.description,
    similarity: Math.round(s.score * 100) / 100,
    sharedLabels: (newItem.labels ?? []).filter(l => (s.item.labels ?? []).includes(l)),
  }));

  const recommendations: string[] = [];
  if (decision === 'duplicate') {
    recommendations.push(`This appears to be a duplicate of "${scored[0]?.item.title}". Consider linking to it instead of creating a new item.`);
  } else if (decision === 'likely_duplicate') {
    recommendations.push(`Very similar to "${scored[0]?.item.title}" (${Math.round(topScore * 100)}% match). Review before proceeding.`);
  } else if (decision === 'overlap') {
    recommendations.push(`Overlaps with ${scored.length} existing item(s). Consider whether this extends existing work or is genuinely new.`);
    if (scored[0]) recommendations.push(`Most similar: "${scored[0].item.title}"`);
  } else if (decision === 'related') {
    recommendations.push(`Related to existing work: ${scored.slice(0, 2).map(s => `"${s.item.title}"`).join(', ')}`);
  }

  return {
    decision,
    confidence: topScore,
    similarItems,
    recommendations,
    reasoning: `Highest similarity: ${Math.round(topScore * 100)}% with "${scored[0]?.item.title ?? 'none'}". Decision: ${decision}.`,
    shouldBlock: decision === 'duplicate',
    shouldWarn: decision === 'likely_duplicate' || decision === 'overlap',
  };
}
