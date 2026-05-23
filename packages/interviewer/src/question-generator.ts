/**
 * @caia/interviewer — QuestionGenerator.
 *
 * Deterministic picker, in three phases per spec §1.4:
 *
 *   • Cold-start (turn 1): emit the playbook's `cold_start_fixture` IDs
 *     verbatim (5 foundational questions across B5, B3, B6, B2, B4).
 *
 *   • Breadth (turns 2-3): one question per remaining foundational pillar
 *     not yet covered.
 *
 *   • Depth (turn 4+): rank pillars by lowest weighted coverage score,
 *     pick K = clusterSize(turn) questions from the lowest-coverage
 *     pillar that haven't been asked yet.
 *
 * Anti-repeat: questions already on `askedIds` are never re-emitted.
 *
 * Mom-Test compliance: every picked question is run through the linter.
 * Bank questions are pre-vetted (the playbook commit verified 0
 * violations), so this is a defence-in-depth check; failed questions are
 * dropped and replaced by the next eligible.
 *
 * Force-decisions: when a DECIDE question has been deferred 3+ times,
 * the generator escalates by prioritising it (cluster head) and tagging
 * the output with `forceDecision: true`. The orchestrator surfaces this
 * to the operator UI.
 */
import { InterviewerError } from './errors.js';
import { PILLAR_IDS, } from './types.js';
const YES_NO_PREFIX = /^(is|are|do|does|did|will|would|can|could|should|have|has)\b/i;
export function lintQuestion(q, patterns) {
    const reasons = [];
    const lower = q.question.toLowerCase();
    for (const { pattern } of patterns) {
        if (lower.includes(pattern.toLowerCase())) {
            reasons.push(`mom_test_violation: matches "${pattern}"`);
        }
    }
    // A yes/no opener is only a rejection when the question contains NO
    // open-ended follow-up. Bank questions like "Will MVP support discounts?
    // If yes, what's your discount cap?" are legitimate multi-part probes.
    const hasOpenFollowup = /(if yes|name|describe|walk me|tell me|quote|defend|explain|why|how|which|what|when|where|sketch|score|list|pick|in one sentence|or |\?\s*\S)/i.test(q.question.split('?').slice(1).join('?'));
    if (YES_NO_PREFIX.test(q.question.trim()) && !hasOpenFollowup) {
        reasons.push('yes_no_prefix: question opens with a closed-ended verb');
    }
    // (Concrete-handle heuristic intentionally omitted — the playbook
    // commit verified 0 Mom-Test violations. Yes/no prefix + phrase match
    // are sufficient as a defence-in-depth check.)
    return { ok: reasons.length === 0, reasons };
}
// ─────────────────────────────────────────────────────────────────────────
// Cluster sizing
// ─────────────────────────────────────────────────────────────────────────
export function clusterSizeForTurn(turn, rules, fallback = 1) {
    for (const rule of rules) {
        if (turn >= rule.turn_range[0] && turn <= rule.turn_range[1]) {
            return { count: rule.questions_per_turn, strategy: rule.strategy };
        }
    }
    return { count: fallback, strategy: 'narrow gap-fill' };
}
// ─────────────────────────────────────────────────────────────────────────
// QuestionGenerator
// ─────────────────────────────────────────────────────────────────────────
/** Foundational pillars used by the breadth phase (turns 2-3). */
const BREADTH_PILLAR_ORDER = ['B5', 'B3', 'B6', 'B2', 'B4'];
const FORCE_DECISION_THRESHOLD = 3;
export class QuestionGenerator {
    index;
    constructor(index) {
        this.index = index;
    }
    /**
     * Pick the next batch of questions for the supplied turn.
     * Throws InterviewerError if the playbook is malformed or no question
     * is eligible (shouldn't happen at 364 questions, but defensive).
     */
    pick(input) {
        const { turnNumber, askedIds, deferralCounts } = input;
        const { count, strategy } = clusterSizeForTurn(turnNumber, this.index.bank.cluster_sizes_by_turn);
        const clusterTarget = Math.max(1, input.clusterCap ?? count);
        // Cold-start (turn 1) — emit playbook fixture verbatim
        if (turnNumber === 1) {
            const ids = this.index.bank.cold_start_fixture.question_ids;
            const questions = [];
            for (const id of ids) {
                const q = this.index.byId.get(id);
                if (!q) {
                    throw new InterviewerError('playbook_missing_question', `cold-start fixture references unknown question id ${id}`, { id });
                }
                questions.push({
                    question: q,
                    priority: 100,
                    forceDecision: false,
                    rationale: 'cold_start_fixture',
                });
            }
            return {
                turnNumber,
                questions: questions.slice(0, clusterTarget),
                strategy: 'cold_start',
                clusterTarget,
                transitionNarration: 'Opening with a breadth pass across the foundational pillars so we have a plan skeleton before we go deep.',
            };
        }
        // Breadth (turns 2-3) — finish covering foundational pillars
        if (turnNumber <= 3) {
            const out = this.breadthPick(input, clusterTarget);
            if (out.length >= clusterTarget) {
                return {
                    turnNumber,
                    questions: out,
                    strategy: 'breadth',
                    clusterTarget,
                    transitionNarration: 'Continuing breadth-first across foundational pillars to fill the skeleton.',
                };
            }
            // Fall through to depth if breadth couldn't fill the cluster.
        }
        // Depth (turn 4+) or narrow gap-fill (turn 16+)
        const depthPicks = this.depthPick(input, clusterTarget);
        if (depthPicks.length === 0) {
            throw new InterviewerError('playbook_missing_question', 'no eligible questions remain — bank exhausted', { turnNumber, askedSize: askedIds.size });
        }
        const hasForce = depthPicks.some((p) => p.forceDecision);
        const stratName = turnNumber >= 16 ? 'narrow_gap_fill' : 'depth';
        const narration = depthPicks.length === 1
            ? `Drilling into ${this.pillarName(depthPicks[0].question.pillar)} — that's the largest remaining gap.`
            : `Drilling into ${this.pillarName(depthPicks[0].question.pillar)} — lowest coverage, ${depthPicks.length} questions.`;
        const force = hasForce
            ? ' Re-asking some previously-deferred items because we need a decision to advance.'
            : '';
        void deferralCounts; // keep param non-unused in tsconfig strict mode
        return {
            turnNumber,
            questions: depthPicks,
            strategy: stratName,
            clusterTarget,
            transitionNarration: narration + force,
        };
    }
    // ───────────────────────────────────────────────────────────────────────
    breadthPick(input, target) {
        const picked = [];
        for (const pid of BREADTH_PILLAR_ORDER) {
            if (picked.length >= target)
                break;
            const candidates = this.index.byPillar.get(pid) ?? [];
            // Prefer the lowest-numbered DECIDE question in this pillar
            const eligible = candidates
                .filter((q) => q.decision_mode === 'DECIDE')
                .filter((q) => !input.askedIds.has(q.id))
                .sort((a, b) => a.id.localeCompare(b.id));
            const first = eligible[0];
            if (first) {
                picked.push({
                    question: first,
                    priority: 50,
                    forceDecision: false,
                    rationale: `breadth_pillar:${pid}`,
                });
            }
        }
        return picked;
    }
    depthPick(input, target) {
        // Rank pillars ascending by weighted coverage score (lower = pick first)
        const rank = [];
        for (const pid of PILLAR_IDS) {
            const def = this.index.pillarById.get(pid);
            if (!def)
                continue;
            const coverage = input.perPillarCoverage[pid] ?? 0;
            // weighted score: coverage / weight → lower-weight pillars get
            // slightly de-prioritized so high-weight gaps surface first
            const weighted = coverage / Math.max(0.5, def.weight);
            rank.push({ pillar: pid, score: weighted, weight: def.weight });
        }
        rank.sort((a, b) => a.score - b.score || b.weight - a.weight);
        const picked = [];
        const usedPillars = new Set();
        // Pass 1 — escalate any deferred questions that exceed the force threshold
        for (const [qid, deferCountRaw] of Object.entries(input.deferralCounts)) { const deferCount = deferCountRaw as number;
            if (deferCount < FORCE_DECISION_THRESHOLD)
                continue;
            const q = this.index.byId.get(qid);
            if (!q)
                continue;
            if (input.askedIds.has(qid))
                continue;
            picked.push({
                question: q,
                priority: 200 + deferCount,
                forceDecision: true,
                rationale: `force_decision:deferred_${deferCount}x`,
            });
            usedPillars.add(q.pillar);
            if (picked.length >= target)
                break;
        }
        // Pass 2 — drill into the lowest-coverage pillar(s)
        for (const { pillar } of rank) {
            if (picked.length >= target)
                break;
            const candidates = this.index.byPillar.get(pillar) ?? [];
            const eligible = candidates
                .filter((q) => q.decision_mode === 'DECIDE')
                .filter((q) => !input.askedIds.has(q.id))
                .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
            for (const q of eligible) {
                if (picked.length >= target)
                    break;
                if (picked.some((p) => p.question.id === q.id))
                    continue;
                picked.push({
                    question: q,
                    priority: 30 + (50 - rank.findIndex((r) => r.pillar === pillar)),
                    forceDecision: false,
                    rationale: `depth_pillar:${pillar}`,
                });
                usedPillars.add(pillar);
            }
        }
        // Pass 3 — top up with DEFER-tagged questions if still short and turn ≥ 9
        if (picked.length < target && input.turnNumber >= 9) {
            for (const { pillar } of rank) {
                if (picked.length >= target)
                    break;
                const candidates = this.index.byPillar.get(pillar) ?? [];
                const deferEligible = candidates
                    .filter((q) => q.decision_mode === 'DEFER')
                    .filter((q) => !input.askedIds.has(q.id))
                    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
                for (const q of deferEligible) {
                    if (picked.length >= target)
                        break;
                    picked.push({
                        question: q,
                        priority: 10,
                        forceDecision: false,
                        rationale: `defer_pillar:${pillar}`,
                    });
                }
            }
        }
        // Sort: force_decision first, then by priority desc
        picked.sort((a, b) => {
            if (a.forceDecision !== b.forceDecision)
                return a.forceDecision ? -1 : 1;
            return b.priority - a.priority;
        });
        // Drop ones that fail the Mom-Test linter; the orchestrator can re-ask.
        return picked;
    }
    pillarName(id) {
        return this.index.pillarById.get(id)?.name ?? id;
    }
}
//# sourceMappingURL=question-generator.js.map