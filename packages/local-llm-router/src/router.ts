// Main routing logic for @chiefaia/local-llm-router.
// Decides local vs Claude based on routing-config.ts, then dispatches
// through the HARDEN-005 resilience stack (breaker -> retry -> timeout).

import { ClaudeAdapter } from './claude-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { getRoute } from './routing-config.js';
import {
  CircuitBreaker,
  TimeoutError,
  BreakerOpenError,
  withRetry,
  withTimeout,
} from './resilience.js';
import type { LLMProvider, LLMRequest, LLMResponse, RouterOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 250;

let _ollama: OllamaAdapter | null = null;
let _claude: ClaudeAdapter | null = null;
const _breakers: Record<LLMProvider, CircuitBreaker> = {
  local: new CircuitBreaker('local'),
  claude: new CircuitBreaker('claude'),
};

function getOllama(): OllamaAdapter {
  _ollama ??= new OllamaAdapter();
  return _ollama;
}

function getClaude(): ClaudeAdapter {
  _claude ??= new ClaudeAdapter();
  return _claude;
}

/**
 * Test-only seam: replace adapters with stubs and (optionally) reset
 * breakers to a known state.
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
 * Test-only seam: reset both circuit breakers to closed.
 * @internal
 */
export function __resetBreakers(): void {
  _breakers.local.reset();
  _breakers.claude.reset();
}

/** Read-only access to the breaker states (for /llm/health surfaces). */
export function getBreakerStates(): Record<LLMProvider, ReturnType<CircuitBreaker['getState']>> {
  return { local: _breakers.local.getState(), claude: _breakers.claude.getState() };
}

/**
 * Route a prompt to the best available provider and return the response.
 *
 * Each dispatch is wrapped in:
 *   breaker.exec( withRetry( withTimeout( dispatch ) ) )
 *
 * @param taskType  One of the keys from ROUTING_RULES.
 * @param prompt    The full user/system prompt text.
 * @param options   Overrides incl. forceLocal / forceClaude / timeoutMs / retryAttempts.
 */
export async function route(
  taskType: string,
  prompt: string,
  options: RouterOptions = {},
): Promise<LLMResponse> {
  const rule = getRoute(taskType);
  const request: LLMRequest = {
    taskType,
    prompt,
    maxTokens: rule.maxTokens,
    temperature: 0.2,
  };

  let preferredProvider: LLMProvider;
  if (options.forceLocal) {
    preferredProvider = 'local';
  } else if (options.forceClaude) {
    preferredProvider = 'claude';
  } else {
    preferredProvider = rule.useLocal ? 'local' : 'claude';
  }

  const fallbackEnabled = options.fallbackOnError ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;

  if (preferredProvider === 'local') {
    try {
      return await callWithResilience(
        'local',
        () => dispatchLocal(rule.localModel, request),
        { taskType, timeoutMs, retryAttempts, retryBaseDelayMs },
      );
    } catch (localErr) {
      if (fallbackEnabled && rule.claudeModel) {
        console.warn(
          `[local-llm-router] Local model "${rule.localModel}" failed for task "${taskType}"; ` +
            `falling back to Claude (${rule.claudeModel}). Error: ${String(localErr)}`,
        );
        return callWithResilience(
          'claude',
          () => dispatchClaude(rule.claudeModel!, request),
          { taskType, timeoutMs, retryAttempts, retryBaseDelayMs },
        );
      }
      throw localErr;
    }
  } else {
    const claudeModel = rule.claudeModel ?? 'claude-sonnet-4-6';
    try {
      return await callWithResilience(
        'claude',
        () => dispatchClaude(claudeModel, request),
        { taskType, timeoutMs, retryAttempts, retryBaseDelayMs },
      );
    } catch (claudeErr) {
      if (fallbackEnabled) {
        console.warn(
          `[local-llm-router] Claude model "${claudeModel}" failed for task "${taskType}"; ` +
            `falling back to local (${rule.localModel}). Error: ${String(claudeErr)}`,
        );
        return callWithResilience(
          'local',
          () => dispatchLocal(rule.localModel, request),
          { taskType, timeoutMs, retryAttempts, retryBaseDelayMs },
        );
      }
      throw claudeErr;
    }
  }
}

interface ResilienceCtx {
  taskType: string;
  timeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
}

async function callWithResilience(
  provider: LLMProvider,
  dispatch: () => Promise<LLMResponse>,
  ctx: ResilienceCtx,
): Promise<LLMResponse> {
  const breaker = _breakers[provider];
  return breaker.exec(() =>
    withRetry(
      () => withTimeout(dispatch(), ctx.timeoutMs, ctx.taskType),
      {
        attempts: ctx.retryAttempts,
        baseDelayMs: ctx.retryBaseDelayMs,
        onRetry: (info) => {
          // Surface as warn so the host process picks it up via stderr.
          // The orchestrator host wraps this in proper structured logs.
          console.warn(
            `[local-llm-router] retry attempt=${info.attempt} delay=${info.delayMs}ms ` +
              `provider=${provider} taskType=${ctx.taskType} error=${String(info.error)}`,
          );
        },
      },
    ),
  );
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

// ─── Public re-exports for callers + tests ─────────────────────────────────

export { TimeoutError, BreakerOpenError };
