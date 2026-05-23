/**
 * @caia/interviewer — BusinessPlanAccumulator.
 *
 * Owns:
 *   1. Per-pillar coverage scoring (0-100) per spec §5.1:
 *        coverage = 0.4 * (decided_required_questions / total_required_in_pillar)
 *                 + 0.4 * (mean_confidence_of_decided_fields)
 *                 + 0.2 * (mean_specificity_of_content_sections_in_pillar)
 *   2. Pillar floor enforcement (≥ 75).
 *   3. Section update writes — pillar → section translation via
 *      PILLAR_TO_SECTIONS.
 *   4. Deterministic specificity score (regex-based, no LLM).
 *   5. Per-dimension rubric assembly (only specificity is computed
 *      deterministically here; the other 9 are scored by the EVALUATING
 *      LLM call and merged via mergeDimensions()).
 *
 * The accumulator is a stateless function library plus a `BusinessPlanAccumulator`
 * convenience class that holds onto a plan + index for ergonomic call sites.
 *
 * It does NOT call any LLM. Coverage and specificity are deterministic.
 */
import { getSection, setSection } from './business-plan.js';
import { InterviewerError } from './errors.js';
import { PILLAR_IDS, PILLAR_TO_SECTIONS, RUBRIC_DIMENSIONS, RUBRIC_WEIGHTS, } from './types.js';
/**
 * Spec §5.1 specificity scoring — 1-5 scale.
 *   1 = generic ("modern professionals")
 *   3 = some anchors
 *   5 = named persons / URLs / numbers
 *
 * Deterministic regex implementation. Catches:
 *   • named entities (proper-noun-cased multi-word phrases)
 *   • URLs (http, www)
 *   • dollar amounts ($1.2M, $200)
 *   • percentages (5%, 12.5%)
 *   • integers ≥ 3 digits ("100 weekly active users")
 *   • year mentions ("by Q4 2026", "in 2027")
 *   • named-bullet structure ("MVP feature 3:")
 */
export function specificityScore(content) {
    if (!content || content.trim().length < 30)
        return 1;
    let anchors = 0;
    const wordCount = content.trim().split(/\s+/).length;
    // URLs
    const urlMatches = content.match(/https?:\/\/\S+|\bwww\.\S+/gi);
    anchors += urlMatches ? urlMatches.length : 0;
    // Dollar amounts
    const dollarMatches = content.match(/\$\s?\d[\d,.]*\s?[KMB]?/gi);
    anchors += dollarMatches ? dollarMatches.length : 0;
    // Percentages
    const pctMatches = content.match(/\b\d+(?:\.\d+)?\s?%/g);
    anchors += pctMatches ? pctMatches.length : 0;
    // Multi-digit numbers (excluding small)
    const numMatches = content.match(/\b\d{3,}\b/g);
    anchors += numMatches ? numMatches.length : 0;
    // Year mentions
    const yearMatches = content.match(/\b(?:19|20)\d{2}\b/g);
    anchors += yearMatches ? yearMatches.length : 0;
    // Proper-noun anchors (consecutive capitalized tokens, len ≥ 2 chars each)
    const properNounMatches = content.match(/\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3}/g);
    anchors += properNounMatches ? properNounMatches.length : 0;
    // Word-anchor density: anchors per 30 words
    const density = anchors / Math.max(1, wordCount / 30);
    if (density >= 4)
        return 5;
    if (density >= 2.5)
        return 4;
    if (density >= 1.2)
        return 3;
    if (density >= 0.4)
        return 2;
    return 1;
}
export function pillarCoverage(input) {
    const decideCount = input.decided.length;
    const ratio = input.totalRequired === 0 ? 1 : Math.min(1, decideCount / input.totalRequired);
    const meanConf = decideCount === 0
        ? 0
        : input.decided.reduce((s, d) => s + d.confidence, 0) / decideCount;
    const meanSpec = input.sections.length === 0
        ? 1
        : input.sections.reduce((s, sec) => s + specificityScore(sec.content), 0) /
            input.sections.length;
    // Normalize meanSpec from 1-5 to 0-100.
    const meanSpec100 = ((meanSpec - 1) / 4) * 100;
    const score = 100 * 0.4 * ratio + 0.4 * meanConf + 0.2 * meanSpec100;
    return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
// ─────────────────────────────────────────────────────────────────────────
// Aggregate rubric (weighted dimensions)
// ─────────────────────────────────────────────────────────────────────────
export function aggregateRubric(dimensions) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const dim of RUBRIC_DIMENSIONS) {
        const score = dimensions[dim];
        const weight = RUBRIC_WEIGHTS[dim];
        weightedSum += score * weight;
        weightTotal += weight;
    }
    const mean = weightedSum / weightTotal; // 1-5 range
    const normalized = ((mean - 1) / 4) * 100; // 0-100 range
    return Math.round(Math.max(0, Math.min(100, normalized)) * 100) / 100;
}
/**
 * Merge LLM-supplied dimensions (1-5 ints) on top of the deterministically
 * computed specificity. The LLM's specificity is ignored — we trust the
 * regex-based one (deterministic, audit-friendly, reproducible).
 */
export function mergeDimensions(llmDims, deterministicSpecificity) {
    const out = {};
    for (const dim of RUBRIC_DIMENSIONS) {
        if (dim === 'specificity') {
            out[dim] = clamp1to5(deterministicSpecificity);
        }
        else {
            out[dim] = clamp1to5(llmDims[dim] ?? 1);
        }
    }
    return out;
}
function clamp1to5(v) {
    if (!Number.isFinite(v))
        return 1;
    if (v < 1)
        return 1;
    if (v > 5)
        return 5;
    return Math.round(v * 10) / 10;
}
export function pillarFloorReport(perPillarCoverage, threshold = 75) {
    const underflow = [];
    for (const pid of PILLAR_IDS) {
        const score = perPillarCoverage[pid];
        if (score < threshold)
            underflow.push({ pillar: pid, score });
    }
    return { threshold, pass: underflow.length === 0, underflow };
}
export class BusinessPlanAccumulator {
    plan;
    index;
    decidedByPillar;
    decidedById;
    rejectedById;
    constructor(plan, index) {
        this.plan = plan;
        this.index = index;
        this.decidedByPillar = new Map(PILLAR_IDS.map((p) => [p, []]));
        this.decidedById = new Set();
        this.rejectedById = new Set();
    }
    getPlan() {
        return this.plan;
    }
    getDecided(pillar) {
        return this.decidedByPillar.get(pillar) ?? [];
    }
    isDecided(questionId) {
        return this.decidedById.has(questionId);
    }
    markRejected(questionId) {
        this.rejectedById.add(questionId);
    }
    isRejected(questionId) {
        return this.rejectedById.has(questionId);
    }
    /**
     * Apply an ingest update — typically produced by the INGESTING LLM call.
     * Mutates the plan in place. Pillar → section translation uses
     * PILLAR_TO_SECTIONS.
     */
    applyUpdate(update) {
        const question = this.index.byId.get(update.questionId);
        if (!question) {
            throw new InterviewerError('playbook_missing_question', `unknown question ${update.questionId} in update`, { questionId: update.questionId });
        }
        if (question.pillar !== update.pillarId) {
            throw new InterviewerError('playbook_missing_question', `pillar mismatch: question ${update.questionId} belongs to ${question.pillar}, update says ${update.pillarId}`, { questionId: update.questionId });
        }
        // Decide bookkeeping
        if (question.decision_mode === 'DECIDE') {
            this.decidedById.add(update.questionId);
            const list = this.decidedByPillar.get(update.pillarId) ?? [];
            // Idempotent — replace prior decided entry for the same question
            const filtered = list.filter((d) => d.questionId !== update.questionId);
            filtered.push({
                questionId: update.questionId,
                pillarId: update.pillarId,
                confidence: update.confidence,
                turnNumber: update.turnNumber,
            });
            this.decidedByPillar.set(update.pillarId, filtered);
        }
        // Section writes
        const sections = PILLAR_TO_SECTIONS[update.pillarId];
        for (const key of sections) {
            const cur = getSection(this.plan, key);
            const newContent = appendIfDistinct(cur.content, update.answerSummary);
            const newConfidence = mergeConfidence(cur.confidence, update.confidence);
            const newPillars = mergePillarsCovered(cur.pillarsCovered ?? [], update.pillarId);
            const next = {
                ...cur,
                content: newContent,
                confidence: newConfidence,
                decisionedAtTurn: Math.max(cur.decisionedAtTurn, update.turnNumber),
                pillarsCovered: newPillars,
                ...(update.structured !== undefined
                    ? { structured: { ...(cur.structured ?? {}), ...update.structured } }
                    : {}),
                ...(update.citations !== undefined && update.citations.length > 0
                    ? {
                        citations: [
                            ...(cur.citations ?? []),
                            ...update.citations.map((c) => ({ ...c, fetchedAt: new Date().toISOString() })),
                        ],
                    }
                    : {}),
            };
            this.plan = setSection(this.plan, key, next);
        }
    }
    /**
     * Compute the per-pillar coverage map (0-100 each).
     * Required-question count comes from the index; sections are pulled
     * from the current plan via PILLAR_TO_SECTIONS.
     */
    computePerPillarCoverage() {
        const out = {};
        for (const pid of PILLAR_IDS) {
            const pillar = this.index.pillarById.get(pid);
            const totalRequired = pillar
                ? pillar.questions.filter((q) => q.decision_mode === 'DECIDE').length
                : 0;
            const decided = this.decidedByPillar.get(pid) ?? [];
            const sectionKeys = PILLAR_TO_SECTIONS[pid];
            const sections = sectionKeys.map((k) => ({ content: getSection(this.plan, k).content }));
            out[pid] = pillarCoverage({ pillarId: pid, totalRequired, decided, sections });
        }
        return out;
    }
    /**
     * Compute the deterministic mean specificity across all 21 sections.
     * Used as the canonical `specificity` rubric dimension.
     */
    meanSpecificity() {
        const sectionKeys = Object.keys(PILLAR_TO_SECTIONS);
        let total = 0;
        let count = 0;
        const seen = new Set();
        for (const pid of sectionKeys) {
            for (const key of PILLAR_TO_SECTIONS[pid]) {
                if (seen.has(key))
                    continue;
                seen.add(key);
                total += specificityScore(getSection(this.plan, key).content);
                count++;
            }
        }
        return count === 0 ? 1 : total / count;
    }
    refreshRubric(extLlmDimensions) {
        const perPillarCoverage = this.computePerPillarCoverage();
        const dimensions = mergeDimensions(extLlmDimensions ?? {}, this.meanSpecificity());
        const aggregateScore = aggregateRubric(dimensions);
        this.plan = {
            ...this.plan,
            rubricScores: { perPillarCoverage, dimensions, aggregateScore },
            lastUpdatedAt: new Date().toISOString(),
        };
        return { perPillarCoverage, dimensions, aggregateScore };
    }
    snapshot() {
        const decidedByPillar = {};
        for (const [pid, list] of this.decidedByPillar.entries()) {
            decidedByPillar[pid] = [...list];
        }
        return {
            plan: this.plan,
            decidedByPillar,
            decidedById: new Set(this.decidedById),
            rejectedById: new Set(this.rejectedById),
        };
    }
}
// ─────────────────────────────────────────────────────────────────────────
// Section merge helpers
// ─────────────────────────────────────────────────────────────────────────
function appendIfDistinct(existing, addition) {
    if (!addition.trim())
        return existing;
    const trimmed = addition.trim();
    if (!existing.trim())
        return trimmed;
    if (existing.includes(trimmed))
        return existing;
    return `${existing.trim()}\n\n${trimmed}`;
}
function mergeConfidence(existing, incoming) {
    if (existing === 0)
        return incoming;
    // weighted blend — newer answers carry more weight
    const blended = existing * 0.4 + incoming * 0.6;
    return Math.round(blended);
}
function mergePillarsCovered(existing, pillar) {
    if (existing.includes(pillar))
        return [...existing];
    return [...existing, pillar];
}
export function buildUpdatesFromExtraction(turn, extractions, index) {
    return extractions.map((e) => {
        const q = index.byId.get(e.questionId);
        if (!q) {
            throw new InterviewerError('playbook_missing_question', `extraction references unknown question ${e.questionId}`, { questionId: e.questionId });
        }
        return {
            questionId: e.questionId,
            pillarId: q.pillar,
            answerSummary: e.answerSummary,
            confidence: e.confidence,
            turnNumber: turn.turnNumber,
            ...(e.structured !== undefined ? { structured: e.structured } : {}),
            ...(e.citations !== undefined ? { citations: e.citations } : {}),
        };
    });
}
//# sourceMappingURL=accumulator.js.map