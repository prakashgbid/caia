/**
 * @chiefaia/vastu — Stage A heuristic regex pre-pass.
 *
 * Extracts structured signals from raw input prose so the LLM enrichment
 * step (text-to-doc.ts) doesn't have to re-discover them. All extraction is
 * deterministic, zero-cost, and offline.
 *
 * The hints are passed:
 *   - to the LLM as context (so it has stable, parsed values to work with)
 *   - back to the caller via FormalDoc.metadata (so downstream stages
 *     don't have to re-parse)
 *
 * Patterns are intentionally permissive — false positives are fine here
 * because the LLM gets a chance to re-evaluate. False negatives are the
 * thing to avoid.
 */
'use strict';

export interface ExtractedHints {
  /** http(s):// URLs and bare-domain references found in the prose. */
  urls: string[];
  /** Email addresses. */
  emails: string[];
  /** Phone numbers (NANP-shaped + international `+...` shapes). */
  phones: string[];
  /** Address-shaped lines (very loose — used as LLM hints, not parsed strictly). */
  addresses: string[];
  /**
   * Inferred industry slugs derived from a small keyword vocabulary
   * (e.g. ['legal', 'real-estate']).
   */
  industries: string[];
  /**
   * Section-name keywords extracted from the prose
   * (e.g. ['hero', 'features', 'pricing']).
   */
  sectionKeywords: string[];
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const BARE_DOMAIN_PATTERN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|ai|app|dev|gg|tv|news|biz|info|me|us|uk|ca|au|de|fr|jp)\b/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const ADDRESS_HINT_PATTERN =
  /\d+\s+[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)*\s+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Lane|Ln|Drive|Dr|Way|Plaza|Square|Sq|Court|Ct)\b/g;

/**
 * Industry → keyword vocabulary. Order matters: earlier matches win
 * in case of overlap (e.g. "law firm" wins over the bare "law" → 'legal').
 */
const INDUSTRY_KEYWORDS: Array<{ slug: string; patterns: RegExp[] }> = [
  {
    slug: 'legal',
    patterns: [/\b(law\s*firm|attorney|lawyer|legal|counsel|litigation|paralegal)\b/i]
  },
  {
    slug: 'real-estate',
    patterns: [/\b(real\s*estate|realty|realtor|property|listings?|homes?\s*for\s*sale)\b/i]
  },
  {
    slug: 'restaurant',
    patterns: [/\b(restaurant|menu|bistro|cafe|café|eatery|kitchen|catering|chef)\b/i]
  },
  {
    slug: 'e-commerce',
    patterns: [/\b(e[-\s]?commerce|online\s*store|shop(?:ify)?|cart|checkout|sku|catalog)\b/i]
  },
  {
    slug: 'healthcare',
    patterns: [/\b(clinic|doctor|physician|hospital|medical|patient|telehealth|dentist)\b/i]
  },
  {
    slug: 'education',
    patterns: [/\b(school|university|college|tutor(?:ing)?|course|curriculum|edtech|classroom)\b/i]
  },
  {
    slug: 'fintech',
    patterns: [/\b(fintech|banking|trading|investment|crypto|wallet|portfolio|loan)\b/i]
  },
  {
    slug: 'saas',
    patterns: [/\b(saas|software\s*as\s*a\s*service|api|dashboard|webhook|subscription\s*plan)\b/i]
  },
  {
    slug: 'gaming',
    patterns: [/\b(game|gaming|gamers?|leaderboard|esports?|tournament|playable)\b/i]
  },
  {
    slug: 'agency',
    patterns: [/\b(agency|studio|consultanc(?:y|ies)|creative\s*shop)\b/i]
  },
  {
    slug: 'portfolio',
    patterns: [/\b(portfolio|case\s*stud(?:y|ies)|works?|showcase|projects?\s*gallery)\b/i]
  },
  {
    slug: 'blog',
    patterns: [/\b(blog|articles?|posts?|newsletter|column|writer)\b/i]
  }
];

/**
 * Section-keyword vocabulary. Match the prose against these to suggest
 * sections to the LLM ("you mentioned a hero — output a hero section").
 *
 * The mapping value is the canonical kebab-case section keyword. The LLM
 * decides the final `section` component name.
 */
const SECTION_KEYWORDS: Array<{ keyword: string; patterns: RegExp[] }> = [
  { keyword: 'hero', patterns: [/\bhero\b/i, /\bbanner\b/i, /\bsplash\b/i] },
  {
    keyword: 'features',
    patterns: [/\bfeatures?\b/i, /\bfeature\s*grid\b/i, /\bcards?\b/i, /\bbenefits?\b/i]
  },
  {
    keyword: 'pricing',
    patterns: [/\bpricing\b/i, /\bplans?\b/i, /\btiers?\b/i, /\bpackages?\b/i]
  },
  {
    keyword: 'testimonials',
    patterns: [/\btestimonials?\b/i, /\bquotes?\b/i, /\bcustomer\s*stor(?:y|ies)\b/i]
  },
  {
    keyword: 'faq',
    patterns: [/\bfaq\b/i, /\bfrequently\s*asked\b/i, /\bquestions?\b/i]
  },
  {
    keyword: 'contact',
    patterns: [/\bcontact\b/i, /\breach\s*us\b/i, /\bget\s*in\s*touch\b/i]
  },
  {
    keyword: 'newsletter',
    patterns: [/\bnewsletter\b/i, /\bsubscribe\b/i, /\bsign[-\s]*up\s*for\s*updates\b/i]
  },
  {
    keyword: 'gallery',
    patterns: [/\bgallery\b/i, /\bphotos?\b/i, /\bimages?\s*grid\b/i]
  },
  {
    keyword: 'team',
    patterns: [/\bteam\b/i, /\bmeet\s*the\s*team\b/i, /\bfounders?\b/i, /\bstaff\b/i]
  },
  { keyword: 'about', patterns: [/\babout\s*us\b/i, /\bour\s*stor(?:y|ies)\b/i, /\bmission\b/i] },
  {
    keyword: 'services',
    patterns: [/\bservices?\b/i, /\bofferings?\b/i, /\bwhat\s*we\s*do\b/i]
  },
  {
    keyword: 'cta',
    patterns: [/\bcta\b/i, /\bcall\s*to\s*action\b/i, /\bsign\s*up\b/i, /\bget\s*started\b/i]
  },
  {
    keyword: 'stats',
    patterns: [/\bstats?\b/i, /\bnumbers?\b/i, /\bmetrics?\b/i, /\bby\s*the\s*numbers\b/i]
  }
];

/**
 * Run the full heuristic pre-pass over the input prose.
 *
 * All arrays are de-duplicated. Order is preserved as best-effort
 * first-seen.
 */
export function extractHeuristics(inputText: string): ExtractedHints {
  const text = inputText ?? '';
  const urls = unique(matchAll(text, URL_PATTERN));
  // Bare domains — but exclude ones already inside an http(s) URL match.
  const bareDomains = unique(matchAll(text, BARE_DOMAIN_PATTERN)).filter(
    (d) => !urls.some((u) => u.includes(d))
  );
  const allUrls = unique([...urls, ...bareDomains]);

  const emails = unique(matchAll(text, EMAIL_PATTERN).map((e) => e.toLowerCase()));

  const rawPhones = matchAll(text, PHONE_PATTERN)
    .map((s) => s.trim())
    // discard "phone-like" sequences that are clearly years, IDs etc.
    .filter((s) => {
      const digits = s.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    });
  const phones = unique(rawPhones);

  const addresses = unique(matchAll(text, ADDRESS_HINT_PATTERN));

  const industries: string[] = [];
  for (const { slug, patterns } of INDUSTRY_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) {
      industries.push(slug);
    }
  }

  const sectionKeywords: string[] = [];
  for (const { keyword, patterns } of SECTION_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) {
      sectionKeywords.push(keyword);
    }
  }

  return {
    urls: allUrls,
    emails,
    phones,
    addresses,
    industries,
    sectionKeywords
  };
}

function matchAll(text: string, pattern: RegExp): string[] {
  // Defensive: rebuild a fresh global regex so /g state from the source
  // cannot leak between calls in a hot path.
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    // safety against zero-width match infinite loops
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function unique<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
