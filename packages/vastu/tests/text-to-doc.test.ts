/**
 * Stage A — text-to-doc real-implementation tests (Phase 2, T4.8).
 *
 * Uses a mock router that mimics @chiefaia/local-llm-router#route, so tests
 * are deterministic and never call out to Ollama.
 */

import { describe, it, expect } from 'vitest';
import { textToDoc, TextToDocLLMError } from '../src/text-to-doc.js';
import { extractHeuristics } from '../src/heuristics.js';
import { mockVastuConfig } from './fixtures/mock-config.js';
import { happyDocResponse, makeMockRouter } from './fixtures/mock-route.js';

describe('textToDoc — input guards', () => {
  it('throws on empty input', async () => {
    await expect(
      textToDoc({ inputText: '   ', config: mockVastuConfig, routeFn: makeMockRouter([]).route })
    ).rejects.toThrow(/empty/i);
  });
});

describe('textToDoc — happy path (LLM produces valid FormalDoc on first try)', () => {
  it('returns a hybrid-origin doc when heuristic signals are present', async () => {
    const router = makeMockRouter([happyDocResponse()]);

    const doc = await textToDoc({
      inputText: 'Visit https://lawfirm.example.com for a free consultation. Email us at hi@lawfirm.example.com or call (415) 555-0100.',
      config: mockVastuConfig,
      pageId: 'home',
      routeFn: router.route
    });

    expect(doc.id).toBe('home');
    expect(doc.origin).toBe('hybrid');
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.metadata?.heuristics).toBeDefined();
    expect(doc.metadata?.llm).toMatchObject({ provider: 'local', attempt: 1 });
    expect(router.calls.length).toBe(1);
    // forceLocal must be set so the zero-dollar gate holds
    expect(router.calls[0]?.options?.forceLocal).toBe(true);
  });

  it('returns origin=llm when no heuristic signal at all', async () => {
    const router = makeMockRouter([happyDocResponse()]);
    const doc = await textToDoc({
      inputText: 'Build me a thing.',
      config: mockVastuConfig,
      pageId: 'thing',
      routeFn: router.route
    });
    // "thing" trips no industry/section keyword; URL/email/phone all absent.
    expect(doc.origin).toBe('llm');
  });

  it('forces id to pageId override even when LLM picks a different id', async () => {
    const llmJson = JSON.stringify({
      id: 'whatever-the-llm-picked',
      name: 'A Page',
      audience: 'general',
      sections: [{ id: 'a', section: 'HeroSection', intent: 'Hero' }],
      origin: 'llm'
    });
    const router = makeMockRouter([llmJson]);
    const doc = await textToDoc({
      inputText: 'Tiny page',
      config: mockVastuConfig,
      pageId: 'override-id',
      routeFn: router.route
    });
    expect(doc.id).toBe('override-id');
    expect(doc.audience).toBe('general');
  });

  it('falls back to config defaults when retry path produces a minimal doc', async () => {
    // First attempt: garbage. Second attempt: minimal schema (sections-only).
    // Retry path should reconstruct, filling audience/brandVoice from config.
    const minimalRetry = JSON.stringify({
      sections: [{ section: 'HeroSection', intent: 'Hero' }]
    });
    const router = makeMockRouter(['nope', minimalRetry]);
    const doc = await textToDoc({
      inputText: 'Tiny page',
      config: mockVastuConfig,
      pageId: 'p',
      routeFn: router.route
    });
    expect(doc.audience).toBe(mockVastuConfig.brandVoice.audience);
    expect(doc.brandVoice).toBe(mockVastuConfig.brandVoice.tone);
  });

  it('strips ```json fences from LLM response', async () => {
    const wrapped = '```json\n' + happyDocResponse() + '\n```';
    const router = makeMockRouter([wrapped]);
    const doc = await textToDoc({
      inputText: 'Build a hero',
      config: mockVastuConfig,
      pageId: 'page',
      routeFn: router.route
    });
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});

describe('textToDoc — retry on malformed LLM response', () => {
  it('falls through to simplified prompt on garbage first response and succeeds', async () => {
    const minimalResponse = JSON.stringify({
      sections: [
        { section: 'HeroSection', intent: 'Hero band' },
        { section: 'FAQSection', intent: 'Frequently asked questions' }
      ]
    });
    const router = makeMockRouter(['this is not json at all', minimalResponse]);

    const doc = await textToDoc({
      inputText: 'Show me a hero and an FAQ',
      config: mockVastuConfig,
      pageId: 'page',
      routeFn: router.route
    });

    expect(router.calls.length).toBe(2);
    expect(doc.sections.length).toBe(2);
    expect(doc.sections[0]?.section).toBe('HeroSection');
    expect(doc.metadata?.llm).toMatchObject({ attempt: 2 });
    // Second prompt should be the simplified one — much shorter
    expect(router.calls[1]?.prompt.length).toBeLessThan(router.calls[0]!.prompt.length);
  });

  it('retries when first response fails Zod schema (missing required fields)', async () => {
    const malformed = JSON.stringify({ id: 'x', sections: [] }); // empty sections array
    const minimal = JSON.stringify({
      sections: [{ section: 'HeroSection', intent: 'Hero' }]
    });
    const router = makeMockRouter([malformed, minimal]);

    const doc = await textToDoc({
      inputText: 'Hero only',
      config: mockVastuConfig,
      routeFn: router.route
    });
    expect(doc.sections.length).toBe(1);
    expect(doc.metadata?.llm).toMatchObject({ attempt: 2 });
  });

  it('throws TextToDocLLMError when both attempts fail to parse', async () => {
    const router = makeMockRouter(['nope', 'still nope']);

    await expect(
      textToDoc({
        inputText: 'Anything',
        config: mockVastuConfig,
        routeFn: router.route
      })
    ).rejects.toBeInstanceOf(TextToDocLLMError);

    expect(router.calls.length).toBe(2);
  });

  it('TextToDocLLMError carries both raw responses for triage', async () => {
    const router = makeMockRouter(['first garbage', 'second garbage']);
    try {
      await textToDoc({
        inputText: 'x',
        config: mockVastuConfig,
        routeFn: router.route
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TextToDocLLMError);
      const err = e as TextToDocLLMError;
      expect(err.fullResponseRaw).toBe('first garbage');
      expect(err.retryResponseRaw).toBe('second garbage');
      expect(err.fullParseError.length).toBeGreaterThan(0);
      expect(err.retryParseError.length).toBeGreaterThan(0);
    }
  });
});

describe('textToDoc — heuristic pre-pass', () => {
  it('extractHeuristics finds URLs, emails, phones, addresses', () => {
    const hints = extractHeuristics(
      [
        'Our practice is at 123 Main Street, San Francisco.',
        'Call (415) 555-0100 or email contact@firm.example.com.',
        'Visit https://firm.example.com for more.'
      ].join(' ')
    );
    expect(hints.urls).toContain('https://firm.example.com');
    expect(hints.emails).toContain('contact@firm.example.com');
    expect(hints.phones.length).toBeGreaterThan(0);
    expect(hints.addresses.length).toBeGreaterThan(0);
  });

  it('extractHeuristics infers industry from keywords', () => {
    expect(extractHeuristics('We are a law firm.').industries).toContain('legal');
    expect(extractHeuristics('Run my online store').industries).toContain('e-commerce');
    expect(extractHeuristics('A tutoring platform for students').industries).toContain(
      'education'
    );
    expect(extractHeuristics('Just a plain page').industries).toEqual([]);
  });

  it('extractHeuristics surfaces section keywords from the prose', () => {
    const hints = extractHeuristics(
      'A hero, three feature cards, a pricing table, and an FAQ section.'
    );
    expect(hints.sectionKeywords).toContain('hero');
    expect(hints.sectionKeywords).toContain('features');
    expect(hints.sectionKeywords).toContain('pricing');
    expect(hints.sectionKeywords).toContain('faq');
  });

  it('extracted heuristics are attached to FormalDoc.metadata', async () => {
    const router = makeMockRouter([happyDocResponse()]);
    const doc = await textToDoc({
      inputText: 'Visit https://example.com — call (415) 555-1212',
      config: mockVastuConfig,
      pageId: 'p',
      routeFn: router.route
    });
    const heuristics = doc.metadata?.heuristics as { urls: string[]; phones: string[] };
    expect(heuristics.urls).toContain('https://example.com');
    expect(heuristics.phones.length).toBeGreaterThan(0);
  });

  it('first inferred industry is promoted to FormalDoc.industry when LLM omits one', async () => {
    const noIndustry = JSON.stringify({
      id: 'p',
      name: 'P',
      audience: 'a',
      sections: [{ id: 's', section: 'HeroSection', intent: 'h' }],
      origin: 'llm'
    });
    const router = makeMockRouter([noIndustry]);
    const doc = await textToDoc({
      inputText: 'A law firm landing page',
      config: mockVastuConfig,
      pageId: 'p',
      routeFn: router.route
    });
    expect(doc.industry).toBe('legal');
  });
});

describe('textToDoc — prompt content sanity', () => {
  it('embeds page id, audience default, and detected hints into the full prompt', async () => {
    const router = makeMockRouter([happyDocResponse()]);
    await textToDoc({
      inputText: 'Restaurant landing page. Visit https://eatery.example.com',
      config: mockVastuConfig,
      pageId: 'home',
      routeFn: router.route
    });
    const prompt = router.calls[0]!.prompt;
    expect(prompt).toContain('home'); // page id
    expect(prompt).toContain(mockVastuConfig.brandVoice.audience);
    expect(prompt).toContain('https://eatery.example.com');
    expect(prompt).toContain('restaurant'); // industry hint
  });
});
