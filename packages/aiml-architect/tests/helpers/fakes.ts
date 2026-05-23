/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Story ticket. The golden test uses this.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Story fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { AIML_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The canonical fixture — a Story ticket from the prakash-tiwari.com
 * marketing site (an `AutoTagIncomingInquiry` AI-classifier story) with
 * intake-derived business plan + (irrelevant-for-AIML) design tokens.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-aiml-001',
      type: 'Story',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Each incoming inquiry email is classified as one of: prospect|press|spam|other.',
        'Classifier latency is < 800ms p95.',
        'No PII in logs — only the inquiry-id, label, and confidence.',
        'Failed classifications fall back to "other" without blocking the inbox.'
      ],
      business_requirements: {
        title: 'Auto-tag incoming inquiry emails',
        description:
          'Run a Claude classifier over each new email arriving at hello@prakash-tiwari.com. Label each email so the operator inbox view can group by category. The classifier returns {label, confidence} per email; the operator sees the label as a badge in the inbox UI.'
      },
      quality_tags: ['ai', 'ml']
    },
    upstream: { outputs: {} },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: "High-intent prospective sitters in the artist's metropolitan area.",
      goals: [
        'Drive contact-form submissions',
        'Project warm + grounded brand voice',
        'Make the booking CTA the page\'s primary action'
      ],
      brandVoice: 'warm + grounded',
      constraints: ['No third-party fonts beyond next/font defaults']
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      snapshotUri: 's3://atlas/designs/design-pt-v3-2026-05-22.png',
      anchors: [
        { anchorId: 'inbox-list', kind: 'list' },
        { anchorId: 'inbox-row-label', kind: 'badge' }
      ],
      tokens: {
        'color.brand.primary': '#0f3057',
        'color.brand.accent': '#e8c547'
      },
      breakpoints: ['sm', 'md', 'lg', 'xl']
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'pt_001',
      vaultNamespace: 'tenant/prakash-tiwari',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 25 }
    },
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 0.5
    }
  };
}

/**
 * The known-good output for the prakash-tiwari Story fixture.
 *
 * One call type — `classifyInquiryIntent` — running Haiku at temperature
 * 0.0 with 5 eval cases, exact-cache 24h, all five mandatory safety
 * checks. Cost class T1, ~$2/month at 500 inquiries/month.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'ai-ml',
    architectureFields: {
      'aiml.modelSelection': {
        classifyInquiryIntent: {
          model: 'haiku',
          rationale:
            'Single-label classification over short email body. Deterministic, bounded output. Haiku is the cheapest tier that clears the eval threshold.',
          fallback: 'sonnet'
        }
      },
      'aiml.promptPatterns': {
        classifyInquiryIntent: {
          systemPrompt:
            'You are an inbox classifier for Prakash Tiwari Studio. Given an incoming email, return a single JSON object {"label": one of "prospect"|"press"|"spam"|"other", "confidence": number in [0,1]}. Never explain your choice. Never emit prose outside the JSON.',
          fewShotExamples: [
            {
              input:
                'Hi! Loved your gallery show. I\'d like to book a sitting for my partner\'s 40th birthday.',
              output: '{"label":"prospect","confidence":0.95}'
            },
            {
              input:
                'Hello, I write for Artist Monthly. Could we feature you in our July issue?',
              output: '{"label":"press","confidence":0.92}'
            }
          ],
          userPromptTemplate: 'Email body:\n\n{{body}}',
          refusalPatterns: [
            'If the email is empty or contains only whitespace, return {"label":"other","confidence":0.0}.',
            'Never echo PII from the email back into the output.'
          ]
        }
      },
      'aiml.evalSuite': {
        classifyInquiryIntent: {
          evalCases: [
            {
              input: 'Booking a portrait sitting for my mom\'s 60th. Available August?',
              expectedOutput: '{"label":"prospect","confidence":>0.85}',
              assertions: ['contains:prospect', 'regex:/"confidence":\\s*0\\.[89]/']
            },
            {
              input: 'Press feature request for our July issue. 500-word interview.',
              expectedOutput: '{"label":"press","confidence":>0.85}',
              assertions: ['contains:press']
            },
            {
              input: 'CLICK NOW to get 90% off luxury watches!!!',
              expectedOutput: '{"label":"spam","confidence":>0.9}',
              assertions: ['contains:spam']
            },
            {
              input: 'Quick question about the framing options on your prints.',
              expectedOutput: '{"label":"prospect","confidence":>0.7}',
              assertions: ['contains:prospect']
            },
            {
              input: 'Hello! Have you seen the news about the new gallery on 5th?',
              expectedOutput: '{"label":"other","confidence":>0.5}',
              assertions: ['contains:other']
            }
          ],
          passThreshold: 0.85,
          metricKey: 'accuracy'
        }
      },
      'aiml.costAttribution': {
        classifyInquiryIntent: {
          costClass: 'T1',
          expectedTokensIn: 400,
          expectedTokensOut: 30,
          dollarsPerCall: 0.0004,
          monthlyForecastUsd: 0.2
        }
      },
      'aiml.aiSafetyChecks': {
        piiDetection: { posture: 'log', stage: 'pre' },
        promptInjectionGuard: { posture: 'block', stage: 'pre' },
        outputContentFilter: { posture: 'warn', stage: 'post' },
        hallucinationGate: { posture: 'warn', stage: 'post' },
        refusalAuditLog: { posture: 'log', stage: 'post' }
      },
      'aiml.temperaturePresets': {
        classifyInquiryIntent: {
          temperature: 0,
          topP: 1,
          maxOutputTokens: 64,
          stopSequences: []
        }
      },
      'aiml.outputSchemas': {
        classifyInquiryIntent: {
          kind: 'object',
          fields: {
            label: {
              kind: 'enum',
              values: ['prospect', 'press', 'spam', 'other']
            },
            confidence: { kind: 'number', min: 0, max: 1 }
          }
        }
      },
      'aiml.cacheStrategy': {
        classifyInquiryIntent: {
          exact: { ttlSeconds: 86400 },
          semantic: null
        }
      }
    },
    confidence: 0.9,
    notes:
      'Single classifier call type for inbox triage. Haiku at temp 0.0 meets the latency + cost budget; eval threshold 0.85 over 5 representative cases. All five safety checks posture-tuned to the low-risk surface. Exact-cache 24h keeps spend at ~$0.20/month at 500 inquiries.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

/** The canonical assistant text — `JSON.stringify(goldenExpectedOutput())`. */
export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

/**
 * Fabricate an `ArchitectSpawnerFn` that returns the given text on every
 * call. Records every call for assertions.
 */
export interface FakeSpawner {
  fn: ArchitectSpawnerFn;
  calls: ArchitectSpawnInput[];
}

export function fakeSpawnerReturning(text: string, ok = true): FakeSpawner {
  const calls: ArchitectSpawnInput[] = [];
  const fn: ArchitectSpawnerFn = async (
    input: ArchitectSpawnInput
  ): Promise<ArchitectSpawnOutput> => {
    calls.push(input);
    return {
      text,
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.01,
      wallClockMs: 1234,
      model: input.budget.preferredModel,
      ok,
      diagnostic: ok ? null : 'forced failure'
    };
  };
  return { fn, calls };
}

/** Fabricate a spawner that returns the canonical golden assistant text. */
export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

/**
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of AIML_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
