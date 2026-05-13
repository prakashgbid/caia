// Main routing logic for @chiefaia/local-llm-router
// Decides local vs Claude based on routing-config.ts, then dispatches.
//
// HARD CONSTRAINT (Prakash 2026-04-30): the Claude path uses the binary
// adapter exclusively (subscription auth via the `claude` CLI). There is
// NO API-key fallback. If the binary fails for any reason -- missing,
// rate-limited, malformed output -- we fall back to Ollama (when
// `fallbackOnError` is enabled) or rethrow.
//
// 2026-05-01 (obs-002): every route() call now emits a `gen_ai.*` OTel
// span via `withSpan` from ./otel. The span carries:
//   - gen_ai.system     ('ollama' | 'claude-binary' | 'cache' | ...)
//   - gen_ai.request.model + gen_ai.response.model
//   - gen_ai.usage.{input,output,total}_tokens (+ legacy aliases)
//   - caia.task_type, caia.route_decision, caia.cache_hit
//   - caia.fallback_from / caia.fallback_reason on fallback paths
// The span is the substrate the obs-foundation feedback loop reads
// (see proposal section 7).

import {
  ClaudeAdapter,
  ClaudeBinaryError,
  ClaudeRateLimitedError,
} from './claude-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import {
  CAIA_ATTR,
  GEN_AI,
  genAiSystemFor,
  withSpan,
  type RouteDecision,
} from './otel.js';
import { getRoute } from './routing-config.js';
import { resolveApprenticeOverride } from './apprentice-override.js';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  RouterOptions,
} from './types.js';

// Singleton adapters -- created lazily so tests can import without side effects.
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
 * @param options   Optional overrides: forceLocal, forceClaude, fallbackOnError, cacheLookup.
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

  // Apprentice Phase 3 override: when a trained apprentice adapter is
  // promoted via apprentice-serving (production / canary), and the task
  // is in the eligible set, swap the rule's `localModel` for the
  // apprentice ollama tag. No-ops cleanly when no adapter is registered.
  let localModelForRequest = rule.localModel;
  let apprenticeSlot: 'production' | 'canary' | null = null;
  if (preferredProvider === 'local') {
    const override = resolveApprenticeOverride(
      options.requestId !== undefined
        ? { taskType, requestId: options.requestId }
        : { taskType }
    );
    if (override !== null) {
      localModelForRequest = override.model;
      apprenticeSlot = override.slot;
    }
  }

  const initialDecision: RouteDecision = preferredProvider === 'local' ? 'local' : 'claude';
  const initialModel = preferredProvider === 'local'
    ? localModelForRequest
    : rule.claudeModel ?? 'claude-sonnet-4-6';

  return withSpan(
    `llm.route ${taskType}`,
    {
      [GEN_AI.OPERATION_NAME]: 'chat',
      [GEN_AI.SYSTEM]: genAiSystemFor(preferredProvider, initialModel),
      [GEN_AI.PROVIDER_NAME]: preferredProvider === 'local' ? 'ollama' : 'subscription',
      [GEN_AI.REQUEST_MODEL]: initialModel,
      [GEN_AI.REQUEST_MAX_TOKENS]: request.maxTokens ?? rule.maxTokens,
      [GEN_AI.REQUEST_TEMPERATURE]: request.temperature ?? 0.2,
      [CAIA_ATTR.TASK_TYPE]: taskType,
      [CAIA_ATTR.ROUTE_DECISION]: initialDecision,
      [CAIA_ATTR.CACHE_HIT]: false,
      [CAIA_ATTR.ROUTER_VERSION]: '0.2.0',
    },
    async (ctx) => {
      // --- Cache short-circuit -------------------------------------
      if (options.cacheLookup) {
        const cached = await options.cacheLookup(taskType, prompt);
        if (cached !== null && cached !== undefined) {
          ctx.span.setAttributes({
            [GEN_AI.SYSTEM]: 'cache',
            [GEN_AI.RESPONSE_MODEL]: cached.model,
            [CAIA_ATTR.ROUTE_DECISION]: 'cache_hit',
            [CAIA_ATTR.CACHE_HIT]: true,
          });
          ctx.recordSuccess(responseAttrs(cached));
          return cached;
        }
      }

      // --- Provider dispatch ---------------------------------------
      let result: LLMResponse;
      let usedFallback = false;
      let fallbackFrom: 'local' | 'claude' | null = null;
      let fallbackReason: string | null = null;

      if (apprenticeSlot !== null) {
        ctx.span.setAttributes({
          ['caia.apprentice.slot']: apprenticeSlot,
          ['caia.apprentice.model']: localModelForRequest,
        });
      }

      if (preferredProvider === 'local') {
        try {
          result = await dispatchLocal(localModelForRequest, request);
        } catch (localErr) {
          if (fallbackEnabled && rule.claudeModel) {
            usedFallback = true;
            fallbackFrom = 'local';
            fallbackReason = String(localErr).slice(0, 200);
            console.warn(
              `[local-llm-router] Local model "${rule.localModel}" failed ` +
                `for task "${taskType}"; falling back to Claude binary (${rule.claudeModel}). ` +
                `Error: ${String(localErr)}`,
            );
            result = await dispatchClaude(rule.claudeModel, request);
          } else {
            throw localErr;
          }
        }
      } else {
        const claudeModel = rule.claudeModel ?? 'claude-sonnet-4-6';
        try {
          result = await dispatchClaude(claudeModel, request);
        } catch (claudeErr) {
          // Rate-limit is a SPECIAL case -- the spend-guard pump handler
          // owns the response (rotate account + maybe pause). We rethrow
          // so the orchestrator can react, but we still allow Ollama
          // fallback as a last resort if the caller opted in.
          if (claudeErr instanceof ClaudeRateLimitedError) {
            if (fallbackEnabled) {
              usedFallback = true;
              fallbackFrom = 'claude';
              fallbackReason = 'rate-limited';
              console.warn(
                `[local-llm-router] Claude binary rate-limited for task "${taskType}"; ` +
                  `falling back to Ollama (${rule.localModel}). Spend-guard should pause / rotate.`,
              );
              result = await dispatchLocal(localModelForRequest, request);
            } else {
              throw claudeErr;
            }
          } else if (claudeErr instanceof ClaudeBinaryError) {
            if (fallbackEnabled) {
              usedFallback = true;
              fallbackFrom = 'claude';
              fallbackReason = `binary-error: ${claudeErr.message}`.slice(0, 200);
              console.warn(
                `[local-llm-router] Claude binary failed (${claudeErr.message}) for task "${taskType}"; ` +
                  `falling back to Ollama (${rule.localModel}). NO API-key fallback (rule).`,
              );
              result = await dispatchLocal(localModelForRequest, request);
            } else {
              throw claudeErr;
            }
          } else {
            // Unknown error -- preserve previous behaviour.
            if (fallbackEnabled) {
              usedFallback = true;
              fallbackFrom = 'claude';
              fallbackReason = `unknown: ${String(claudeErr)}`.slice(0, 200);
              console.warn(
                `[local-llm-router] Claude path failed (${String(claudeErr)}) for task "${taskType}"; ` +
                  `falling back to Ollama (${rule.localModel}).`,
              );
              result = await dispatchLocal(localModelForRequest, request);
            } else {
              throw claudeErr;
            }
          }
        }
      }

      // --- Stamp final response attrs onto the span ----------------
      const successAttrs: Record<string, string | number | boolean | undefined> = {
        ...responseAttrs(result),
      };
      if (usedFallback && fallbackFrom !== null) {
        successAttrs[CAIA_ATTR.FALLBACK_FROM] = fallbackFrom;
        if (fallbackReason !== null) {
          successAttrs[CAIA_ATTR.FALLBACK_REASON] = fallbackReason;
        }
        // The span's gen_ai.system also reflects the actual provider used.
        successAttrs[GEN_AI.SYSTEM] = genAiSystemFor(result.provider, result.model);
        successAttrs[CAIA_ATTR.ROUTE_DECISION] =
          result.provider === 'local' ? 'local' : 'claude';
      }
      ctx.recordSuccess(successAttrs);
      return result;
    },
  );
}

function responseAttrs(
  response: LLMResponse,
): Record<string, string | number | boolean | undefined> {
  const attrs: Record<string, string | number | boolean | undefined> = {
    [GEN_AI.RESPONSE_MODEL]: response.model,
  };
  const usage = response.usage;
  if (usage) {
    if (usage.promptTokens !== undefined) {
      attrs[GEN_AI.USAGE_INPUT_TOKENS] = usage.promptTokens;
      attrs[GEN_AI.USAGE_PROMPT_TOKENS] = usage.promptTokens;
    }
    if (usage.completionTokens !== undefined) {
      attrs[GEN_AI.USAGE_OUTPUT_TOKENS] = usage.completionTokens;
      attrs[GEN_AI.USAGE_COMPLETION_TOKENS] = usage.completionTokens;
    }
    if (usage.totalTokens !== undefined) {
      attrs[GEN_AI.USAGE_TOTAL_TOKENS] = usage.totalTokens;
    }
  }
  return attrs;
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
