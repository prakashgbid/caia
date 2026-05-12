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

import { serve } from '@hono/node-server';
import { buildApp, DEFAULT_ROUTER_PORT } from '../server.js';

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
});

// Graceful exit handlers
const exit = (sig: string) => {
  console.log(`received ${sig} — exiting`);
  process.exit(0);
};
process.on('SIGINT', () => exit('SIGINT'));
process.on('SIGTERM', () => exit('SIGTERM'));
