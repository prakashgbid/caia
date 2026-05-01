export interface ParsedTradeoffs {
  positive: string[];
  negative: string[];
  raw: string;
  structured: boolean;
}

const POSITIVE_RE = /^\s*\*{0,2}(positive|pros?|benefits?)\*{0,2}\s*:?\s*$/i;
const NEGATIVE_RE = /^\s*\*{0,2}(negative|cons?|trade[- ]?offs?|drawbacks?|risks?)[^:]*\*{0,2}\s*:?\s*$/i;
const BULLET_RE = /^\s*[-*•]\s+(.+)$/;

function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').trim();
}

export function parseTradeoffs(text: string): ParsedTradeoffs {
  if (!text) return { positive: [], negative: [], raw: text, structured: false };

  const lines = text.split('\n');
  const positive: string[] = [];
  const negative: string[] = [];
  let section: 'positive' | 'negative' | null = null;

  for (const line of lines) {
    if (POSITIVE_RE.test(line)) {
      section = 'positive';
      continue;
    }
    if (NEGATIVE_RE.test(line)) {
      section = 'negative';
      continue;
    }

    if (!section) continue;

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      const item = stripBold(bulletMatch[1]);
      if (item) (section === 'positive' ? positive : negative).push(item);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
      const item = stripBold(trimmed);
      if (item) (section === 'positive' ? positive : negative).push(item);
    }
  }

  const structured = positive.length + negative.length > 0;
  return { positive, negative, raw: text, structured };
}
