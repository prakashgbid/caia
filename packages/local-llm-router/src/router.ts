// Main routing logic for @chiefaia/local-llm-router
// Decides local vs Claude based on routing-config.ts, then dispatches.

import { ClaudeAdapter } from './claude-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { getRoute } from './routing-config.js';
import type { LLMProvider, LLMRequest, LLMResponse, RouterOptions } from './types.js';

// Singleton adapters — created lazily so tests can import without side effects.
let _ollama: OllamaAdapter | null = null;
let _claude: ClaudeAdapter | null = null;

function getOllama(): OllamaAdapter {
  _ollama ??= new OllamaAdapter();
  return _ollama;
}

function getClaude(): ClaudeAdapter {
  _claude ??= new ClaudeAdapter();
  return _claude;
}

/**
 * Test-only seam: replace adapters with stubs.
 * @internal
 */
export function __setAdapters(
  ollama: OllamaAdapter | null,
  claude: ClaudeAdapter | null,
): void {
  _ollama = ollama;
  _claude = claude;
}

/**
 * Route a prompt to the best available provider and return the response.
 *
 * @param taskType  One of the keys from ROUTING_RULES (e.g. 'domain-classification').
 * @param prompt    The full user/system prompt text.
 * @param options   Optional overrides: forceLocal, forceClaude, fallbackOnError.
 */
export async function route(
  taskType: string,
  prompt: string,
  options: RouterOptions = {},
): Promise<LLMResponse> {
  const rule = getRoute(taskType);

  // Build the LLMRequest
  const request: LLMRequest = {
    taskType,
    prompt,
    maxTokens: rule.maxTokens,
    temperature: 0.2,
  };

  // Determine which provider wins
  let preferredProvider: LLMProvider;
  if (options.forceLocal) {
    preferredProvider = 'local';
  } else if (options.forceClaude) {
    preferredProvider = 'claude';
  } else {
    preferredProvider = rule.useLocal ? 'local' : 'claude';
  }

  const fallbackEnabled = options.fallbackOnError ?? true;

  if (preferredProvider === 'local') {
    try {
      return await dispatchLocal(rule.localModel, request);
    } catch (localErr) {
      if (fallbackEnabled && rule.claudeModel) {
        console.warn(
          `[local-llm-router] Local model "${rule.localModel}" failed ` +
            `for task "${taskType}"; falling back to Claude (${rule.claudeModel}). ` +
            `Error: ${String(localErr)}`,
        );
        return await dispatchClaude(rule.claudeModel, request);
      }
      throw localErr;
    }
  } else {
    const claudeModel = rule.claudeModel ?? 'claude-sonnet-4-6';
    try {
      return await dispatchClaude(claudeModel, request);
    } catch (claudeErr) {
      if (fallbackEnabled) {
        console.warn(
          `[local-llm-router] Claude model "${claudeModel}" failed ` +
            `for task "${taskType}"; falling back to local (${rule.localModel}). ` +
            `Error: ${String(claudeErr)}`,
        );
        return await dispatchLocal(rule.localModel, request);
      }
      throw claudeErr;
    }
  }
}

async function dispatchLocal(
  model: string,
  request: LLMRequest,
): Promise<LLMResponse> {
  const ollama = getOllama();
  const available = await ollama.isAvailable();
  if (!available) {
    throw new Error(
      'Ollama daemon is not reachable at http://127.0.0.1:11434. ' +
        'Run `ollama serve` or install Ollama first.',
    );
  }
  return ollama.generate(model, request);
}

async function dispatchClaude(
  model: string,
  request: LLMRequest,
): Promise<LLMResponse> {
  return getClaude().generate(model, request);
}
