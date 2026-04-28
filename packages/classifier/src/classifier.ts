import {
  FUNCTIONAL_DOMAINS,
  NATURE_KEYWORDS,
  type DomainDefinition,
  type NatureLabel,
  type ComplexityLabel,
  type LayerLabel,
} from './taxonomy';

export interface ClassificationResult {
  primaryDomain: string;       // e.g. 'auth'
  subDomain?: string;          // e.g. 'auth.sso'
  additionalDomains: string[]; // other relevant domains
  nature: NatureLabel;
  complexity: ComplexityLabel;
  layer: LayerLabel;
  allLabels: string[];         // flat list of all labels
  confidence: number;          // 0-1
  reasoning: string;           // human-readable explanation
}

export interface ClassifierConfig {
  aiProvider?: 'claude' | 'keyword-only'; // keyword-only works without AI
  claudeApiKey?: string;
  projectTaxonomyExtensions?: DomainDefinition[]; // project-specific additions
}

function estimateComplexity(text: string): ComplexityLabel {
  const words = text.split(/\s+/).length;
  if (words < 10) return 'trivial';
  if (words < 25) return 'small';
  if (words < 60) return 'medium';
  if (words < 120) return 'large';
  return 'xl';
}

function estimateLayer(text: string, primaryDomain: string): LayerLabel {
  const lower = text.toLowerCase();
  if (['ui-frontend'].includes(primaryDomain)) return 'frontend';
  if (['api-integration', 'devops'].includes(primaryDomain)) return 'backend';
  if (primaryDomain === 'data-storage') return 'database';
  if (primaryDomain === 'devops') return 'infrastructure';
  if (lower.includes('ui') || lower.includes('frontend') || lower.includes('component')) return 'frontend';
  if (lower.includes('api') || lower.includes('backend') || lower.includes('server')) return 'backend';
  if (lower.includes('database') || lower.includes('schema') || lower.includes('migration')) return 'database';
  return 'full-stack';
}

function classifyNature(text: string): { nature: NatureLabel; confidence: number } {
  const lower = text.toLowerCase();
  const scores: Record<NatureLabel, number> = {} as Record<NatureLabel, number>;

  for (const [nature, keywords] of Object.entries(NATURE_KEYWORDS) as [NatureLabel, string[]][]) {
    scores[nature] = keywords.filter(k => lower.includes(k)).length;
  }

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topNature = sorted[0][0] as NatureLabel;
  const topScore = sorted[0][1];

  return {
    nature: topScore > 0 ? topNature : 'feature',
    confidence: Math.min(topScore / 3, 1),
  };
}

function scoreDomain(text: string, domain: DomainDefinition): number {
  const lower = text.toLowerCase();
  let score = domain.keywords.filter(k => lower.includes(k)).length;

  // Sub-domain bonus
  if (domain.subDomains) {
    for (const sub of domain.subDomains) {
      const subScore = sub.keywords.filter(k => lower.includes(k)).length;
      if (subScore > 0) score += subScore * 1.5;
    }
  }

  return score;
}

export function classifyKeyword(text: string, config: ClassifierConfig = {}): ClassificationResult {
  const allDomains = [...FUNCTIONAL_DOMAINS, ...(config.projectTaxonomyExtensions ?? [])];

  // Score each domain
  const scores = allDomains
    .map(domain => ({ domain, score: scoreDomain(text, domain) }))
    .sort((a, b) => b.score - a.score);

  const primaryDomainDef = scores[0];
  const primaryDomain = primaryDomainDef.score > 0 ? primaryDomainDef.domain.slug : 'business-logic';
  const confidence = Math.min(primaryDomainDef.score / 5, 1);

  // Sub-domain detection
  let subDomain: string | undefined;
  if (primaryDomainDef.domain.subDomains) {
    const lower = text.toLowerCase();
    const matchedSub = primaryDomainDef.domain.subDomains.find(
      sub => sub.keywords.some(k => lower.includes(k)),
    );
    if (matchedSub) subDomain = matchedSub.slug;
  }

  // Additional domains (score > 0 but not primary)
  const additionalDomains = scores
    .slice(1)
    .filter(s => s.score > 0)
    .slice(0, 3)
    .map(s => s.domain.slug);

  const { nature } = classifyNature(text);
  const complexity = estimateComplexity(text);
  const layer = estimateLayer(text, primaryDomain);

  const allLabels = [
    primaryDomain,
    ...(subDomain ? [subDomain] : []),
    ...additionalDomains,
    nature,
    complexity,
    layer,
  ];

  return {
    primaryDomain,
    subDomain,
    additionalDomains,
    nature,
    complexity,
    layer,
    allLabels,
    confidence,
    reasoning: `Primary domain "${primaryDomain}" matched ${primaryDomainDef.score} keywords. Nature: "${nature}". Complexity: "${complexity}" based on text length.`,
  };
}

// Main entry point — tries AI first, falls back to keyword.
// AI enhancement can be added later per ADR-001 Living Library principle.
export async function classify(text: string, config: ClassifierConfig = {}): Promise<ClassificationResult> {
  return classifyKeyword(text, config);
}
