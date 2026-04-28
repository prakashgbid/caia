function tokenize(text: string): Set<string> {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Generate bigrams for better phrase matching
  const tokens = new Set<string>(words);
  for (let i = 0; i < words.length - 1; i++) {
    tokens.add(`${words[i]}_${words[i + 1]}`);
  }
  return tokens;
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

export function labelOverlapScore(labelsA: string[], labelsB: string[]): number {
  if (labelsA.length === 0 || labelsB.length === 0) return 0;
  const setA = new Set(labelsA);
  const matches = labelsB.filter(l => setA.has(l)).length;
  return matches / Math.max(labelsA.length, labelsB.length);
}

// Combined score: weighted average of text similarity and label overlap
export function combinedScore(
  textSimilarity: number,
  labelOverlap: number,
  textWeight = 0.7,
  labelWeight = 0.3
): number {
  return (textSimilarity * textWeight) + (labelOverlap * labelWeight);
}
