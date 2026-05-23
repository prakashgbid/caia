/**
 * @caia/interviewer — Critic subagent.
 *
 * The Critic runs a separate, isolated LLM session — a Series Seed VC
 * partner persona — and emits a structured verdict per spec §5.4.
 *
 * Gate (handoff approval):
 *   recommendation === "meeting" AND no `blocker`-severity items.
 *
 * If `pass_kind` OR any blocker-severity item, the orchestrator rolls
 * the state machine back to PLANNING with `blockers[].planSection`
 * lifted into picker hints. The Critic runs at most twice per
 * interview; the orchestrator enforces that cap.
 *
 * The class accepts an injected `LlmCaller`, so the orchestrator can
 * supply a `ScriptedLlmCaller` for deterministic tests and the
 * production path uses `DefaultLlmCaller`.
 */
import { criticPassSchema } from './business-plan.js';
import { InterviewerError } from './errors.js';
import { extractJsonObject } from './llm.js';
import { criticPassSystemPrompt, criticPassUserPrompt } from './prompts.js';
export class Critic {
    opts;
    passes = 0;
    maxPasses;
    constructor(opts) {
        this.opts = opts;
        this.maxPasses = opts.maxPasses ?? 2;
    }
    get passesRun() {
        return this.passes;
    }
    get atCap() {
        return this.passes >= this.maxPasses;
    }
    /**
     * Run a critic pass against the plan. Returns the parsed verdict.
     * Throws if past the max-passes cap (the orchestrator should check
     * `atCap` before calling).
     */
    async run(input) {
        if (this.passes >= this.maxPasses) {
            throw new InterviewerError('critic_call_failed', `critic already ran ${this.passes} pass(es), cap is ${this.maxPasses}`, { passes: this.passes, cap: this.maxPasses });
        }
        const passNumber = (this.passes + 1);
        const callOpts = {
            systemPrompt: criticPassSystemPrompt(),
            ...(this.opts.timeoutMs !== undefined ? { maxBudgetMs: this.opts.timeoutMs } : {}),
            ...(this.opts.modelHint !== undefined ? { modelHint: this.opts.modelHint } : {}),
        };
        const result = await this.opts.llm.call(criticPassUserPrompt(input.plan), callOpts);
        if (!result.ok) {
            throw new InterviewerError('critic_call_failed', `critic LLM call failed: ${result.diagnostic ?? 'unknown'}`, { diagnostic: result.diagnostic });
        }
        let raw;
        try {
            raw = extractJsonObject(result.text);
        }
        catch (e) {
            throw new InterviewerError('critic_parse_error', `critic returned non-JSON: ${e.message}`, { preview: result.text.slice(0, 200) });
        }
        raw = normalizeCriticShape(raw);
        const parsed = criticPassSchema.safeParse({
            ...raw,
            ranAtTurn: input.atTurn,
            passNumber,
        });
        if (!parsed.success) {
            throw new InterviewerError('critic_parse_error', `critic JSON does not match schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`, { issues: parsed.error.issues });
        }
        this.passes++;
        return parsed.data;
    }
    /**
     * Gate decision: convert a verdict into a binary approve/roll-back
     * decision + the picker hints to surface back to PLANNING on rollback.
     */
    static gate(verdict) {
        const blockingIssues = verdict.blockers.filter((b) => b.severity === 'blocker');
        const approved = verdict.recommendation === 'meeting' && blockingIssues.length === 0;
        const pickerHints = [
            ...blockingIssues.map((b) => b.planSection),
            ...verdict.blockers.filter((b) => b.severity === 'major').map((b) => b.planSection),
        ];
        return {
            approved,
            recommendation: verdict.recommendation,
            blockingIssues,
            pickerHints: [...new Set(pickerHints)],
            raw: verdict,
        };
    }
}
/**
 * Some models emit snake_case keys despite prompting for camelCase.
 * Normalize the obvious aliases so downstream parsing succeeds.
 */
function normalizeCriticShape(raw) {
    if (typeof raw !== 'object' || raw === null)
        return raw;
    const r = { ...raw };
    if (!('top5DecisionFactors' in r) && 'top_5_decision_factors' in r) {
        r['top5DecisionFactors'] = r['top_5_decision_factors'];
        delete r['top_5_decision_factors'];
    }
    if (!('meetingQuestions' in r) && 'meeting_questions' in r) {
        r['meetingQuestions'] = r['meeting_questions'];
        delete r['meeting_questions'];
    }
    return r;
}
//# sourceMappingURL=critic.js.map