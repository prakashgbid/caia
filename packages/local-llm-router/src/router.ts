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
import { screenForInjection } from './adversarial-prefilter.js';
import { shouldEscalate as cascadeShouldEscalate } from './cascade-escalation.js';
import {
  CAIA_ATTR,
  GEN_AI,
  genAiSystemFor,
  withSpan,
  type RouteDecision,
} from './otel.js';
import { getRoute, ROUTING_RULES, type RoutingRule } from './routing-config.js';
import { resolveApprenticeOverride } from './apprentice-override.js';
import { emitMentorEvent, newDecisionId } from './mentor-emit.js';
import {
  llmMetrics,
  perCallCostFromRuleString,
  type LlmMetricsProvider,
} from './llm-metrics.js';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  RouterOptions,
} from './types.js';

type DisplacementClass =
  | 'local'
  | 'apprentice-canary'
  | 'claude'
  | 'cached'
  | 'fallback';

type RouterEventProvider = 'ollama' | 'apprentice' | 'claude' | 'cache' | 'other';

function providerForEvent(
  llmProvider: LLMProvider,
  apprenticeSlot: 'production' | 'canary' | null,
): RouterEventProvider {
  if (llmProvider === 'claude') return 'claude';
  if (apprenticeSlot !== null) return 'apprentice';
  return 'ollama';
}

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

  // RR-1 fast mitigation (2026-05-15): adversarial pre-screen runs before
  // the route decision so a 7B local model never sees instruction-override,
  // role-play escape, prompt-leak, or JSON-hijack attempts. On match we
  // force-escalate to claude and stamp the emitted RouterDecision with
  // reason=adversarial-rejected for the dashboard. Always-claude when
  // `forceLocal` is NOT set; if the caller explicitly passes forceLocal,
  // we still escalate (security overrides convenience).
  const adversarial = screenForInjection(prompt);

  // Determine which provider wins
  let preferredProvider: LLMProvider;
  if (adversarial.blocked) {
    preferredProvider = 'claude';
  } else if (options.forceLocal) {
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

  // B1 (2026-05-15) — structured dispatch log. Before this, only the
  // RouterDecision telemetry recorded WHICH model was chosen; nothing
  // surfaced WHY. The silent-tier-collapse audit found that the dispatcher
  // was serving 7b for intents whose cascade design said 14b/32b, but the
  // metrics couldn't distinguish "rule-says-7b" from "rule-missing-default-7b".
  // The structured log makes the decision path observable in real time so
  // a follow-up regression is visible in `tail -f` without restarting.
  // Format is single-line key=value for cheap grep / jq pipelines.
  emitDispatchLog({
    taskType,
    rule,
    preferredProvider,
    chosenModel: initialModel,
    adversarialBlocked: adversarial.blocked,
    adversarialMatched: adversarial.matched ?? null,
    forceLocal: options.forceLocal === true,
    forceClaude: options.forceClaude === true,
    apprenticeSlot,
  });

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
      const decisionId = newDecisionId();
      const routeStartMs = Date.now();

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
          const cacheLatencyMs = Date.now() - routeStartMs;
          emitMentorEvent('RouterDecision', {
            decisionId,
            modelChosen: cached.model,
            provider: 'cache',
            displacementClass: 'cached',
            latencyMs: cacheLatencyMs,
            caiaTaskType: taskType,
          });
          // A.9.1.1 — cache hits are pure savings against the
          // would-have-been claude baseline.
          recordLlmMetric({
            taskType,
            rule,
            response: cached,
            cacheHitKind: 'exact',
            displacementClass: 'cached',
            durationMs: cacheLatencyMs,
          });
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

        // R-1 (2026-05-15): cascade fall-through. The local model returned
        // without throwing, but the response itself may signal that the
        // call should have gone to claude — empty/short output, explicit
        // needs_escalation flag, JSON-parse failure on JSON-shaped output,
        // or canonical refusal openers. Re-dispatch to claude when a
        // claudeModel is configured, fallback is enabled, and the caller
        // didn't force-pin to local. forceLocal callers accept the local
        // result regardless of confidence (caller opted out of cascade).
        if (
          !usedFallback &&
          fallbackEnabled &&
          rule.claudeModel &&
          !options.forceLocal
        ) {
          const cascade = cascadeShouldEscalate(result);
          if (cascade.shouldEscalate) {
            const triggerLabel = cascade.trigger ?? 'unknown';
            const reasonLabel = cascade.reason ?? 'unknown';
            usedFallback = true;
            fallbackFrom = 'local';
            fallbackReason = `cascade-escalation:${triggerLabel}:${reasonLabel}`.slice(0, 200);
            console.warn(
              `[local-llm-router] Local model "${rule.localModel}" returned ` +
                `low-confidence output for task "${taskType}" ` +
                `(trigger=${triggerLabel}, reason=${reasonLabel}); ` +
                `escalating to Claude binary (${rule.claudeModel}).`,
            );
            result = await dispatchClaude(rule.claudeModel, request);
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

      // --- Emit RouterDecision (fire-and-forget) -------------------
      let displacementClass: DisplacementClass;
      if (usedFallback) {
        displacementClass = 'fallback';
      } else if (result.provider === 'claude') {
        displacementClass = 'claude';
      } else if (apprenticeSlot !== null) {
        displacementClass = 'apprentice-canary';
      } else {
        displacementClass = 'local';
      }
      const routerEventProvider = providerForEvent(result.provider, apprenticeSlot);
      const finalLatencyMs = Date.now() - routeStartMs;
      let escalationReason: string | null = null;
      if (adversarial.blocked) {
        // RR-1: adversarial reason takes priority over fallback for the
        // dashboard. The matched pattern name rides along so the eval can
        // attribute false-positives to specific rules.
        const matchedSuffix = adversarial.matched
          ? `:${adversarial.matched}`
          : '';
        escalationReason =
          `adversarial-rejected:${adversarial.reason ?? 'unknown'}${matchedSuffix}`.slice(0, 200);
      } else if (usedFallback && fallbackFrom !== null) {
        escalationReason = `fallback from ${fallbackFrom}${fallbackReason ? ': ' + fallbackReason : ''}`.slice(0, 200);
      }
      const payload: Record<string, unknown> = {
        decisionId,
        modelChosen: result.model,
        provider: routerEventProvider,
        displacementClass,
        latencyMs: finalLatencyMs,
        caiaTaskType: taskType,
      };
      if (escalationReason !== null) payload['reason'] = escalationReason;
      if (adversarial.blocked) {
        payload['adversarialBlocked'] = true;
        if (adversarial.matched) payload['adversarialMatched'] = adversarial.matched;
      }
      emitMentorEvent('RouterDecision', payload);

      // A.9.1.1 — record llmMetrics at every dispatch decision (local,
      // claude, fallback) so /metrics and the displacement dashboard
      // see the real share. Fail-soft: any throw inside the recorder
      // is swallowed so the dispatch isn't broken by telemetry.
      recordLlmMetric({
        taskType,
        rule,
        response: result,
        displacementClass,
        durationMs: finalLatencyMs,
        ...(escalationReason !== null ? { escalationReason } : {}),
      });

      return result;
    },
  );
}

// A.9.1.1 — central recorder. Wraps llmMetrics.record() so the router
// can call it from cache + dispatch + fallback paths without repeating
// the bookkeeping. Cost columns come from the routing rule (per-1000
// strings). Failures are swallowed — telemetry must never break dispatch.
function recordLlmMetric(args: {
  taskType: string;
  rule: RoutingRule;
  response: LLMResponse;
  displacementClass: DisplacementClass;
  durationMs: number;
  cacheHitKind?: 'exact' | 'semantic';
  escalationReason?: string;
}): void {
  try {
    const provider: LlmMetricsProvider =
      args.response.provider === 'local' ? 'local' : 'claude';
    // Baseline = what the call WOULD have cost if it had gone to Claude.
    // estimated = what it actually cost (0 for local + cache; claude per-call
    // estimate otherwise).
    const baselinePerCallUsd = perCallCostFromRuleString(
      args.rule.estimatedCostClaude,
    );
    let estimatedCostUsd: number;
    if (args.cacheHitKind !== undefined) {
      estimatedCostUsd = 0;
    } else if (provider === 'local') {
      estimatedCostUsd = perCallCostFromRuleString(args.rule.estimatedCostLocal);
    } else {
      estimatedCostUsd = baselinePerCallUsd;
    }
    const record: Parameters<typeof llmMetrics.record>[0] = {
      taskType: args.taskType,
      provider,
      model: args.response.model,
      durationMs: args.durationMs,
      estimatedCostUsd,
      baselineCostUsd: baselinePerCallUsd,
      timestamp: Date.now(),
    };
    const usage = args.response.usage;
    if (usage?.promptTokens !== undefined) record.promptTokens = usage.promptTokens;
    if (usage?.completionTokens !== undefined) {
      record.completionTokens = usage.completionTokens;
    }
    if (args.cacheHitKind !== undefined) record.cacheHitKind = args.cacheHitKind;
    llmMetrics.record(record);
  } catch {
    /* telemetry must never break dispatch */
  }
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

// B1 (2026-05-15) — structured dispatch log. Single-line key=value emit so
// `tail -f stderr | grep '\[router\] dispatch'` shows intent=X chose model=Y
// reason=Z without restart. Reason is one of:
//   - adversarial-rejected         (RR-1 prefilter forced claude)
//   - force-local / force-claude   (caller override)
//   - rule-local / rule-claude     (routing-config decision)
//   - rule-default-local           (unknown task type → 7b default — the
//                                   silent-tier-collapse smoking gun, kept
//                                   warn-level so it's visible by default)
function emitDispatchLog(args: {
  taskType: string;
  rule: RoutingRule;
  preferredProvider: LLMProvider;
  chosenModel: string;
  adversarialBlocked: boolean;
  adversarialMatched: string | null;
  forceLocal: boolean;
  forceClaude: boolean;
  apprenticeSlot: 'production' | 'canary' | null;
}): void {
  try {
    const hasExplicitRule = ROUTING_RULES_INDEX.has(args.taskType);
    let reason: string;
    if (args.adversarialBlocked) {
      reason = args.adversarialMatched
        ? `adversarial-rejected:${args.adversarialMatched}`
        : 'adversarial-rejected';
    } else if (args.forceLocal) {
      reason = 'force-local';
    } else if (args.forceClaude) {
      reason = 'force-claude';
    } else if (!hasExplicitRule) {
      reason = 'rule-default-local';
    } else if (args.preferredProvider === 'local') {
      reason = args.rule.useLocal ? 'rule-local' : 'rule-local-override';
    } else {
      reason = args.rule.useLocal ? 'rule-claude-override' : 'rule-claude';
    }
    const apprentice = args.apprenticeSlot
      ? ` apprentice=${args.apprenticeSlot}`
      : '';
    const ruleStatus = hasExplicitRule ? 'registered' : 'unregistered';
    // intent= is the taxonomy key (== taskType when the caller routes by
    // classifier-v2 intent name). model= is what the dispatcher will hand
    // to ollama/claude. reason= is one of the labels above.
    console.warn(
      `[router] dispatch intent=${args.taskType} model=${args.chosenModel} ` +
        `provider=${args.preferredProvider} reason=${reason} ` +
        `rule=${ruleStatus} useLocal=${args.rule.useLocal}${apprentice}`,
    );
  } catch {
    /* logging must never break dispatch */
  }
}

// Static index over ROUTING_RULES so the dispatch log can detect whether a
// taskType has an explicit rule without re-scanning the array on every call.
// Built at module load; routing-config is a static const.
const ROUTING_RULES_INDEX: Set<string> = new Set(
  ROUTING_RULES.map((r) => r.taskType),
);

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
