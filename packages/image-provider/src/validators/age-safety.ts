import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type AgeSafetyResult = 'clear' | 'contains-minor' | 'uncertain';

export const SAFE_NON_PERSON_KEYWORDS = [
  'casino interior',
  'poker chips',
  'playing cards',
  'roulette wheel',
  'felt table',
  'casino chips',
  'card deck',
  'poker table',
  'chips stack',
  'blackjack table',
];

// Words that immediately trigger rejection when found standalone in metadata
const HARD_REJECT_TERMS = [
  'child', 'children', 'kid', 'kids', 'toddler', 'baby', 'infant',
  'teen', 'teenager', 'minor', 'junior',
];

// Paired-context terms: reject only when paired with age-indicator words
const AGE_INDICATORS = ['boy', 'girl', 'kid', 'child', 'student', 'class', 'children', 'age', 'young', 'teen', 'baby', 'toddler', 'minor'];

interface RejectionLog {
  id: string;
  reason: string;
  metadata: { title?: string; tags?: string[]; alt?: string; description?: string };
  timestamp: string;
}

function logRejection(entry: RejectionLog): void {
  const dir = join(homedir(), '.image-provider');
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'rejected-age-safety.jsonl'),
      JSON.stringify(entry) + '\n',
      'utf-8',
    );
  } catch {
    // Non-fatal — log failure silently
  }
}

function buildSearchText(metadata: { title?: string; tags?: string[]; alt?: string; description?: string }): string {
  return [
    metadata.title ?? '',
    metadata.alt ?? '',
    metadata.description ?? '',
    ...(metadata.tags ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function wordsNear(text: string, anchor: string, within: number, targets: string[]): boolean {
  const words = text.split(/\W+/);
  const anchorIdx = words.indexOf(anchor);
  if (anchorIdx < 0) return false;
  const windowStart = Math.max(0, anchorIdx - within);
  const windowEnd = Math.min(words.length - 1, anchorIdx + within);
  const window = words.slice(windowStart, windowEnd + 1);
  return targets.some(t => window.includes(t));
}

function metadataContainsMinor(text: string): boolean {
  const words = new Set(text.split(/\W+/).filter(Boolean));

  // Check hard-reject standalone terms
  for (const term of HARD_REJECT_TERMS) {
    if (term.includes(' ')) {
      if (text.includes(term)) return true;
    } else {
      if (words.has(term)) return true;
    }
  }

  // "little girl" / "little boy"
  if (text.includes('little girl') || text.includes('little boy')) return true;

  // "school" paired with age indicators within 5 words
  if (words.has('school') && wordsNear(text, 'school', 5, AGE_INDICATORS)) return true;

  // "playground" paired with age indicators
  if (words.has('playground') && wordsNear(text, 'playground', 5, AGE_INDICATORS)) return true;

  // "student" paired with age indicators
  if (words.has('student') && wordsNear(text, 'student', 5, AGE_INDICATORS.filter(w => w !== 'student'))) return true;

  // "family" paired with child-specific words within 5 words
  const childSpecific = ['kid', 'child', 'baby', 'toddler', 'children'];
  if (words.has('family') && wordsNear(text, 'family', 5, childSpecific)) return true;

  return false;
}

async function hasPeopleInImage(imageBuffer: Buffer): Promise<boolean> {
  try {
    // Dynamically import to allow mocking in tests
    const { pipeline } = await import('@xenova/transformers');
    const classifier = await pipeline('image-classification', 'Xenova/vit-base-patch16-224');

    // Convert buffer to base64 data URI for the pipeline
    const base64 = imageBuffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;

    const results = await classifier(dataUri) as Array<{ label: string; score: number }>;

    // Check if any result with score > 0.5 relates to person/people
    const personLabels = ['person', 'people', 'man', 'woman', 'human', 'face', 'player', 'crowd'];
    return results.some(
      r => r.score > 0.5 && personLabels.some(label => r.label.toLowerCase().includes(label)),
    );
  } catch {
    // If detection fails, assume people present (conservative)
    return true;
  }
}

async function checkWithFalAi(imageBuffer: Buffer): Promise<AgeSafetyResult> {
  const timeoutMs = 10_000;

  try {
    const { fal } = await import('@fal-ai/client');

    const base64 = imageBuffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let result: AgeSafetyResult = 'uncertain';

    try {
      const response = await Promise.race([
        fal.subscribe('fal-ai/any-llm', {
          input: {
            model: 'google/gemini-flash-1.5',
            prompt:
              'Is this image safe for an adult 21+ gambling/casino context? Reply with exactly one word: CLEAR (only adults visible or no people), MINOR (anyone who could be under 21 is visible), or UNCERTAIN (age unclear).',
            image_url: dataUri,
          },
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('timeout'))),
        ),
      ]) as { output?: string };

      clearTimeout(timeoutId);

      const answer = (response.output ?? '').trim().toUpperCase();
      if (answer === 'CLEAR') result = 'clear';
      else if (answer === 'MINOR') result = 'contains-minor';
      else result = 'uncertain';
    } catch {
      clearTimeout(timeoutId);
      result = 'uncertain';
    }

    return result;
  } catch {
    return 'uncertain';
  }
}

export async function containsMinor(
  imageBuffer: Buffer,
  metadata: { title?: string; tags?: string[]; alt?: string; description?: string },
): Promise<AgeSafetyResult> {
  const searchText = buildSearchText(metadata);

  // Layer 1: Metadata scan
  if (metadataContainsMinor(searchText)) {
    logRejection({
      id: `meta-${Date.now()}`,
      reason: 'metadata-keyword-match',
      metadata,
      timestamp: new Date().toISOString(),
    });
    return 'contains-minor';
  }

  // Layer 2: Visual check — only if metadata passes
  const hasPeople = await hasPeopleInImage(imageBuffer);
  if (!hasPeople) {
    // No people detected — safe
    return 'clear';
  }

  // People detected — defer to fal.ai for age assessment
  const falResult = await checkWithFalAi(imageBuffer);

  if (falResult !== 'clear') {
    logRejection({
      id: `visual-${Date.now()}`,
      reason: `fal-ai-result:${falResult}`,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  return falResult;
}
