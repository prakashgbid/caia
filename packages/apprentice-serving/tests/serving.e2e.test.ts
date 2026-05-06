/**
 * Real-Ollama E2E test. Gated by APPRENTICE_SERVING_OLLAMA_INSTALLED=1.
 * Skipped by default in CI; operator runs locally to verify the
 * subprocess + filesystem + canary-routing flow against the live
 * Ollama daemon.
 *
 * Strategy: build a tiny Modelfile that just FROMs a small base model
 * already pulled by the operator (defaulting to qwen2.5-coder:7b — the
 * canonical CAIA training base). NO adapter file is referenced — we're
 * exercising the registry + subprocess plumbing, not adapter weights.
 *
 * Cleanup: the test removes any models it created on teardown.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApprenticeServing } from '../src/serving.js';
import { SubprocessOllamaClient } from '../src/ollama-client.js';

const GATE_ENV = 'APPRENTICE_SERVING_OLLAMA_INSTALLED';
const gated = process.env[GATE_ENV] === '1';
const itGated = gated ? it : it.skip;
const baseTag = process.env['APPRENTICE_SERVING_E2E_BASE_TAG'] ?? 'qwen2.5-coder:7b';

const tmpRoot = path.join(os.tmpdir(), `apprentice-serving-e2e-${Date.now()}`);
const adapterPath = path.join(tmpRoot, 'adapters', '2026-05-06-e2e');
const registryPath = path.join(tmpRoot, 'registry.json');
const canaryRoutingPath = path.join(tmpRoot, 'canary-routing.json');

const createdModels: string[] = [];

beforeAll(async () => {
  if (!gated) return;
  fs.mkdirSync(adapterPath, { recursive: true });
  // Build a tiny Modelfile that doesn't actually use the adapter file —
  // just FROM the base. This is enough to validate the create/rm path.
  fs.writeFileSync(
    path.join(adapterPath, 'Modelfile'),
    `FROM ${baseTag}\nPARAMETER temperature 0.2\n`
  );
  fs.writeFileSync(path.join(adapterPath, 'adapters.safetensors'), 'STUB');
  fs.writeFileSync(path.join(adapterPath, 'adapter_config.json'), '{"rank":8}');
  fs.writeFileSync(
    path.join(adapterPath, 'training-metadata.json'),
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        baseModel: baseTag,
        baseModelOllamaTag: baseTag,
        configSha256: 'e2e-' + Math.random().toString(36).slice(2, 10)
      },
      null,
      2
    )
  );
});

afterAll(async () => {
  if (!gated) return;
  // Best-effort cleanup of created Ollama models.
  const client = new SubprocessOllamaClient({
    ollamaBinaryPath: 'ollama',
    timeoutMs: 60_000
  });
  for (const m of createdModels) {
    try {
      await client.remove(m);
    } catch {
      /* ignore */
    }
  }
  // Best-effort cleanup of tmp dir.
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe(`ApprenticeServing E2E (gated by ${GATE_ENV}=1)`, () => {
  itGated('verifies ollama --version', async () => {
    const client = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 30_000
    });
    const v = await client.version();
    expect(v.length).toBeGreaterThan(0);
  });

  itGated('runs full lifecycle against live Ollama', async () => {
    const serving = new ApprenticeServing({
      registryPath,
      canaryRoutingConfigPath: canaryRoutingPath,
      ollamaTimeoutMs: 5 * 60 * 1000
    });

    // Step 1: register
    const reg = await serving.register(adapterPath);
    expect(reg.status).toBe('registered');

    // Step 2: canary
    const canary = await serving.promoteToCanary(adapterPath, 10);
    expect(canary.status).toBe('canary');
    if (canary.ollamaModelName) createdModels.push(canary.ollamaModelName);

    // Step 3: production
    const prod = await serving.promoteToProduction(adapterPath);
    expect(prod.status).toBe('production');
    if (prod.ollamaModelName) createdModels.push(prod.ollamaModelName);

    // Step 4: verify canary-routing config
    const decision = serving.canaryRouter.resolve();
    expect(decision.kind).toBe('production-only');

    // Step 5: list confirms model is present. Ollama auto-appends `:latest`
    // to models created without an explicit tag, so accept either form.
    const client = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 30_000
    });
    const models = await client.list();
    const expected = prod.ollamaModelName!;
    const found = models.some((m) => m === expected || m === `${expected}:latest`);
    expect(found, `expected ${expected} (or ${expected}:latest) in ${JSON.stringify(models)}`).toBe(true);
  }, 10 * 60 * 1000);
});
