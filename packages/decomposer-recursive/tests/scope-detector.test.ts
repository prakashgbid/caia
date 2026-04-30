import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { detectScope } from '../src/scope-detector.js';
import { StructuredOutputParseError } from '../src/structured-output.js';

import {
  fakeOllama,
  fakeClaude,
  installFakeAdapters,
  clearAdapters,
  jsonResponse,
} from './_helpers.js';

describe('detectScope', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('classifies a one-line story-shaped prompt as story', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          targetScope: 'story',
          confidence: 0.92,
          rationale: 'one verb, one object, one concrete deliverable',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({
      promptText: 'add a logout button to the user-menu dropdown',
    });

    expect(out.targetScope).toBe('story');
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.rationale).toMatch(/one verb/);
    expect(out.model).toContain('qwen');
  });

  it('classifies a vision-doc-shaped prompt as initiative', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          targetScope: 'initiative',
          confidence: 0.86,
          rationale: 'multi-feature, multi-team, multi-platform vision',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({
      promptText:
        'Build a poker analytics SaaS. Web + mobile + Stripe billing + Discord integration. Multi-team multi-quarter.',
    });

    expect(out.targetScope).toBe('initiative');
    expect(out.confidence).toBeCloseTo(0.86);
  });

  it('passes the optional vision-doc summary into the prompt body', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          targetScope: 'epic',
          confidence: 0.7,
          rationale: 'single epic scope per pre-extracted theme',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({
      promptText: 'Re-vamp checkout',
      visionDocSummary: 'Theme: cart abandonment, single-page checkout',
    });

    expect(out.targetScope).toBe('epic');
    // The router was called once.
    expect(ollama.generate).toHaveBeenCalledOnce();
  });

  it('retries when the model returns an out-of-range confidence', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({ targetScope: 'task', confidence: 1.7, rationale: 'meh' }),
        jsonResponse({
          targetScope: 'task',
          confidence: 0.55,
          rationale: 'one concern, one tech sub-domain',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({ promptText: 'refactor the auth module' });
    expect(out.targetScope).toBe('task');
    expect(out.confidence).toBeCloseTo(0.55);
  });

  it('throws when the model never produces a valid scope', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({ targetScope: 'feature', confidence: 0.5, rationale: 'meh' }),
        jsonResponse({ targetScope: 'feature', confidence: 0.5, rationale: 'meh' }),
        jsonResponse({ targetScope: 'feature', confidence: 0.5, rationale: 'meh' }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    await expect(detectScope({ promptText: 'whatever' })).rejects.toBeInstanceOf(
      StructuredOutputParseError,
    );
  });

  it('includes telemetry (model + durationMs)', async () => {
    const ollama = fakeOllama({
      responses: [
        {
          response: JSON.stringify({
            targetScope: 'subtask',
            confidence: 0.99,
            rationale: 'mechanical edit',
          }),
          model: 'qwen2.5-coder:7b',
          durationMs: 17,
        },
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({
      promptText: 'rename _x to _internal in foo.ts',
    });

    expect(out.model).toBe('qwen2.5-coder:7b');
    expect(out.durationMs).toBe(17);
  });
});
