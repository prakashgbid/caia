// Integration test against a live Ollama daemon at http://127.0.0.1:11434.
//
// Skipped automatically when:
//   - SKIP_OLLAMA_INTEGRATION=1 is set
//   - The daemon is not reachable
//   - No models are pulled
//
// In CI we set SKIP_OLLAMA_INTEGRATION=1 because the runner has no Ollama;
// locally (and on Prakash's Mac) it runs against the first available model.

import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaAdapter } from '../src/ollama-adapter.js';

let ollamaUp = false;
let availableModel: string | null = null;

beforeAll(async () => {
  if (process.env['SKIP_OLLAMA_INTEGRATION'] === '1') return;

  const adapter = new OllamaAdapter('http://127.0.0.1:11434');
  ollamaUp = await adapter.isAvailable();
  if (!ollamaUp) return;

  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    // Prefer an explicit override, then the smallest available chat model.
    const override = process.env['OLLAMA_TEST_MODEL'];
    if (override && data.models?.some((m) => m.name === override)) {
      availableModel = override;
    } else {
      availableModel = data.models?.[0]?.name ?? null;
    }
  } catch {
    availableModel = null;
  }
});

describe.skipIf(process.env['SKIP_OLLAMA_INTEGRATION'] === '1')(
  'integration: live Ollama',
  () => {
    it('detects daemon availability', () => {
      if (!ollamaUp) {
        // eslint-disable-next-line no-console
        console.warn(
          '[integration] Ollama not running — skipping live tests. ' +
            'Run `ollama serve` to enable.',
        );
        return;
      }
      expect(ollamaUp).toBe(true);
    });

    it('generates a response from a local model end-to-end', async () => {
      if (!ollamaUp || !availableModel) {
        // eslint-disable-next-line no-console
        console.warn(
          `[integration] Skipping — ollamaUp=${ollamaUp}, model=${availableModel ?? 'none'}`,
        );
        return;
      }

      const adapter = new OllamaAdapter('http://127.0.0.1:11434');
      const start = Date.now();
      const res = await adapter.generate(availableModel, {
        taskType: 'domain-classification',
        prompt:
          'Reply with a single word — the most likely domain for "user signs in with email": auth, ui, payments, or other.',
        maxTokens: 20,
        temperature: 0,
      });
      const elapsed = Date.now() - start;

      expect(res.provider).toBe('local');
      expect(res.model).toBe(availableModel);
      expect(res.response.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(
        `[integration] Local route latency: ${elapsed}ms, model=${res.model}, response=${JSON.stringify(res.response.slice(0, 80))}`,
      );
      // Generous bound — first model load can be slow, but should be far
      // under the 180s adapter timeout.
      expect(elapsed).toBeLessThan(180_000);
    }, 200_000);
  },
);
