#!/usr/bin/env node
// Entrypoint for the local-llm-router daemon.
// Usage:
//   caia-llm-router-daemon [--port <n>] [--ollama-url <url>] [--classifier-model <name>]
//
// Defaults:
//   --port 7411
//   --ollama-url http://127.0.0.1:11434  (or env OLLAMA_BASE_URL)
//   --classifier-model qwen2.5-coder:7b  (or env ROUTER_CLASSIFIER_MODEL;
//                                          will become qwen2.5-coder-7b-caia-apprentice
//                                          once the LoRA is trained)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { buildApp, DEFAULT_ROUTER_PORT } from '../server.js';
import { getRouterOllamaAdapter } from '../router.js';

// Phase A2 --health-check shortcut. The post-merge gate (A1) invokes
// `<bin> --health-check` after `launchctl kickstart` and expects exit 0
// in ≤5s with single-line JSON on stdout. Runs BEFORE the server binds
// the port (which would fail if a previous instance is still listening).
if (process.argv.includes('--health-check')) {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  process.stdout.write(
    JSON.stringify({
      ok: true,
      label: process.env['CAIA_PLIST_LABEL'] ?? null,
      package: pkg.name,
      version: pkg.version,
      git_sha: process.env['CAIA_GIT_SHA'] ?? 'unknown',
      node: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
  process.exit(0);
}

interface Args {
  port: number;
  ollamaUrl: string | undefined;
  classifierModel: string | undefined;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    port: Number(process.env['ROUTER_PORT'] ?? DEFAULT_ROUTER_PORT),
    ollamaUrl: process.env['OLLAMA_BASE_URL'],
    classifierModel: process.env['ROUTER_CLASSIFIER_MODEL'],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--port' && i + 1 < argv.length) { out.port = Number(argv[++i]); }
    else if (a === '--ollama-url' && i + 1 < argv.length) { out.ollamaUrl = argv[++i]; }
    else if (a === '--classifier-model' && i + 1 < argv.length) { out.classifierModel = argv[++i]; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`caia-llm-router-daemon — local-llm-router HTTP daemon

Usage:
  caia-llm-router-daemon [options]

Options:
  --port <n>                  Listen port (default ${DEFAULT_ROUTER_PORT}, env ROUTER_PORT)
  --ollama-url <url>          Ollama base URL (env OLLAMA_BASE_URL)
  --classifier-model <name>   Classifier model tag (env ROUTER_CLASSIFIER_MODEL)
  -h, --help                  Show this help

Endpoints:
  GET  /healthz
  GET  /metrics
  POST /v1/intent             { task_spec }
  POST /v1/route              { task_type, prompt }
  POST /v1/chat/completions   OpenAI-compatible
  POST /v1/embeddings         OpenAI-compatible
  POST /v1/optimize           3-stage prompt optimizer (LAI phase 8)
`);
  process.exit(0);
}

const app = buildApp({
  ...(args.ollamaUrl !== undefined ? { ollamaBaseUrl: args.ollamaUrl } : {}),
  ...(args.classifierModel !== undefined ? { classifierModel: args.classifierModel } : {}),
});

const port = Number.isFinite(args.port) ? args.port : DEFAULT_ROUTER_PORT;

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`caia-llm-router-daemon listening on http://${info.address}:${info.port}`);
  console.log(`  ollama_url=${args.ollamaUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434'}`);
  console.log(`  classifier_model=${args.classifierModel ?? process.env['ROUTER_CLASSIFIER_MODEL'] ?? 'qwen2.5-coder:7b'}`);

  // RR-3 (2026-05-16): daemon-start async warmup. Comma-separated list of
  // ollama tags in env ROUTER_WARMUP_MODELS gets fired-and-forgotten as
  // soon as the listener is up. We do NOT await — the daemon stays
  // responsive while warmup happens in the background. Per-model failures
  // are logged but never crash the daemon (a missing weight should be an
  // operator alert, not a service outage).
  const warmupRaw = process.env['ROUTER_WARMUP_MODELS'] ?? '';
  const warmupModels = warmupRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (warmupModels.length > 0) {
    const adapter = getRouterOllamaAdapter();
    console.log(`[router] daemon-start warmup queued for: ${warmupModels.join(', ')}`);
    for (const model of warmupModels) {
      adapter
        .warmup(model)
        .then(({ warmedMs }) => {
          console.log(`[router] daemon-start warmup ok model=${model} warmed_ms=${warmedMs}`);
        })
        .catch((err: Error) => {
          console.warn(`[router] daemon-start warmup FAILED model=${model} error=${err.message}`);
        });
    }
  }
});

// Graceful exit handlers
const exit = (sig: string) => {
  console.log(`received ${sig} — exiting`);
  process.exit(0);
};
process.on('SIGINT', () => exit('SIGINT'));
process.on('SIGTERM', () => exit('SIGTERM'));
