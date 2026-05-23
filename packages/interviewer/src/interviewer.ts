/**
 * @caia/interviewer — orchestrator (public API).
 *
 * `Interviewer` is the only class most callers need. It composes:
 *   - StateMachine          (FSM with guarded transitions)
 *   - QuestionGenerator     (deterministic picker)
 *   - BusinessPlanAccumulator (per-pillar coverage + section writes)
 *   - Critic                (Series Seed VC subagent)
 *   - LlmCaller             (LLM dispatch)
 *   - InterviewerPersistencePort (Postgres or memory)
 *
 * The orchestrator drives one interview from `start()` (creates the row,
 * runs INIT, picks turn-1 questions) through `submitUserReply(text)`
 * loops (INGESTING → EVALUATING → … → COMPLETE → HANDOFF) until either
 * the gate passes or the operator calls `forceClose()`.
 *
 * Threshold (spec §5): aggregate ≥ 82 AND every pillar floor ≥ 75 AND
 * the Critic returns `meeting` with no blockers. The aggregate is a
 * weighted mean of 10 dimensions (specificity is computed
 * deterministically; the other 9 are LLM-scored).
 *
 * All side-effects (DB writes, LLM calls) flow through injected ports so
 * the engine is fully testable with `ScriptedLlmCaller` +
 * `MemoryInterviewerPersistence`.
 */
import { randomUUID } from 'node:crypto';
import { BusinessPlanAccumulator, buildUpdatesFromExtraction, } from './accumulator.js';
import { businessPlanV2Schema, emptyBusinessPlan, getSection, setSection, } from './business-plan.js';
import { Critic } from './critic.js';
import { InterviewerError } from './errors.js';
import { extractJsonObject } from './llm.js';
import { MemoryInterviewerPersistence, } from './persistence.js';
import { ingestExtractionPrompt, initExtractionPrompt, rubricEvaluationPrompt, selfCritiquePrompt, } from './prompts.js';
import { QuestionGenerator, } from './question-generator.js';
import { StateMachine } from './state-machine.js';
import { PILLAR_TO_SECTIONS, } from './types.js';
// ─────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────
export class Interviewer {
    playbook;
    llm;
    persistence;
    tenantSlug;
    operatorEmail;
    llmCallBudget;
    satisfactionThreshold;
    pillarFloor;
    maxTurns;
    idFactory;
    clock;
    interviewId = null;
    state;
    accumulator = null;
    generator;
    critic = null;
    askedIds = new Set();
    deferralCounts = {};
    lastPick = null;
    llmCallCount = 0;
    revisionNumber = 0;
    openUnknowns = [];
    operatorLog = [];
    criticVerdicts = [];
    latestRubric = null;
    grandIdea = '';
    constructor(opts) {
        this.playbook = opts.playbook;
        this.llm = opts.llm;
        this.persistence = opts.persistence ?? new MemoryInterviewerPersistence();
        this.tenantSlug = opts.tenantSlug;
        this.operatorEmail = opts.operatorEmail;
        this.llmCallBudget = opts.llmCallBudget ?? 150;
        this.satisfactionThreshold = opts.satisfactionThreshold ?? 82;
        this.pillarFloor = opts.pillarFloor ?? 75;
        this.maxTurns = opts.maxTurns ?? 50;
        this.idFactory = opts.idFactory ?? randomUUID;
        this.clock = opts.clock ?? (() => new Date());
        this.state = new StateMachine('INIT', 0);
        this.generator = new QuestionGenerator(this.playbook);
    }
    // ─────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────
    async start(input) {
        if (this.interviewId !== null) {
            throw new InterviewerError('persistence_failure', 'interviewer already started', {
                interviewId: this.interviewId,
            });
        }
        const id = input.interviewId ?? this.idFactory();
        this.interviewId = id;
        this.grandIdea = input.grandIdeaPrompt;
        await this.persistence.ensureSchema(this.tenantSlug);
        await this.persistence.createInterview({
            id,
            tenantSlug: this.tenantSlug,
            operatorEmail: this.operatorEmail,
            grandIdeaPrompt: input.grandIdeaPrompt,
            llmCallBudget: this.llmCallBudget,
            ...(input.responderRole !== undefined ? { responderRole: input.responderRole } : {}),
        });
        // Initialize plan + critic + accumulator
        const plan = emptyBusinessPlan({
            interviewId: id,
            operatorEmail: this.operatorEmail,
            createdAt: this.clock(),
        });
        this.accumulator = new BusinessPlanAccumulator(plan, this.playbook);
        this.critic = new Critic({ llm: this.llm });
        // INIT extraction (single LLM call to extract the 4-field skeleton)
        await this.runInitExtraction();
        this.transition('PLANNING', 'init_complete');
        // PLANNING → ASKING (deterministic pick, no LLM call)
        const pick = await this.runPlanning(1);
        const askedAt = this.clock();
        this.transition('ASKING', 'questions_picked', 1);
        await this.persistAgentTurn(1, pick, askedAt);
        this.transition('AWAITING_USER', 'questions_sent', 1);
        await this.persistence.updateState({
            interviewId: id,
            tenantSlug: this.tenantSlug,
            state: 'AWAITING_USER',
            turnNumber: 1,
            llmCallCount: this.llmCallCount,
        });
        return {
            interviewId: id,
            state: this.state.state,
            turnNumber: 1,
            agentMessage: formatAgentMessage(pick),
            picked: pick,
        };
    }
    async submitUserReply(text) {
        this.requireStarted();
        if (this.state.state !== 'AWAITING_USER') {
            throw new InterviewerError('invalid_state_transition', `submitUserReply requires AWAITING_USER, current ${this.state.state}`, { state: this.state.state });
        }
        if (this.lastPick === null) {
            throw new InterviewerError('invalid_state_transition', 'no questions pending — internal state corrupt');
        }
        const turn = this.state.turnNumber;
        await this.persistence.appendTurn({
            id: this.idFactory(),
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            turnNumber: turn,
            role: 'user',
            content: text,
            askedAt: this.clock(),
            answeredAt: this.clock(),
            llmCallCount: 0,
        });
        // INGESTING — extract per-question answers
        this.transition('INGESTING', 'user_reply');
        const extractions = await this.runIngestion(text);
        this.applyExtractions(extractions, turn);
        this.recordDeferrals(extractions.unanswered, turn);
        // EVALUATING — score the plan
        this.transition('EVALUATING', 'ingest_complete');
        const rubric = await this.runEvaluation();
        this.latestRubric = rubric;
        await this.snapshotRevision(turn, rubric);
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'EVALUATING',
            turnNumber: turn,
            llmCallCount: this.llmCallCount,
            rubricAggregateScore: rubric.aggregateScore,
        });
        const meetsThreshold = this.meetsThreshold(rubric);
        if (!meetsThreshold) {
            // Loop back to PLANNING for the next turn
            return await this.continueWithNextTurn(turn);
        }
        // SELF_CRITIQUE
        this.transition('SELF_CRITIQUE', 'threshold_met');
        const selfCritiquePassed = await this.runSelfCritique(turn);
        if (!selfCritiquePassed) {
            return await this.continueWithNextTurn(turn);
        }
        // Critic pass (Series Seed VC subagent)
        const verdict = await this.critic.run({ plan: this.accumulator.getPlan(), atTurn: turn });
        this.criticVerdicts.push(verdict);
        this.llmCallCount++;
        const gate = Critic.gate(verdict);
        if (!gate.approved) {
            // roll back to PLANNING using picker hints
            this.recordOperatorDecision(turn, 'critic_rollback', 'pass', 'roll_back', 'critic_blockers');
            return await this.continueWithNextTurn(turn);
        }
        // COMPLETE → HANDOFF
        this.transition('COMPLETE', 'critic_approved');
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'COMPLETE',
            turnNumber: turn,
            criticPassesRun: this.criticVerdicts.length,
            rubricAggregateScore: rubric.aggregateScore,
        });
        this.transition('HANDOFF', 'handoff_emitted');
        const plan = this.accumulator.getPlan();
        const finalPlan = this.attachFinalMetadata(plan, verdict);
        await this.snapshotRevision(turn, rubric, finalPlan);
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'HANDOFF',
            turnNumber: turn,
            criticPassesRun: this.criticVerdicts.length,
        });
        return {
            state: 'HANDOFF',
            turnNumber: turn,
            agentMessage: handoffMessage(),
            satisfactionScore: rubric.aggregateScore,
            criticVerdict: verdict,
            handoff: finalPlan,
        };
    }
    // ─────────────────────────────────────────────────────────────────────
    // Resume / pause / force-close
    // ─────────────────────────────────────────────────────────────────────
    async pause() {
        this.requireStarted();
        if (this.state.state !== 'AWAITING_USER')
            return;
        this.transition('PAUSED', 'operator_pause');
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'PAUSED',
            turnNumber: this.state.turnNumber,
        });
    }
    /**
     * Resume from PAUSED — re-runs PLANNING + ASKING for the next turn.
     * Spec §1.2: "PAUSED → PLANNING (re-evaluates first)" — we pick fresh
     * questions rather than re-emit the prior batch (the prior turn was
     * already logged, and the plan may have drifted between sessions).
     */
    async resume() {
        this.requireStarted();
        if (this.state.state !== 'PAUSED') {
            throw new InterviewerError('resume_invalid_state', `resume requires PAUSED, current ${this.state.state}`, { state: this.state.state });
        }
        // state.resume() walks PAUSED → PLANNING for us; emit the same turn
        // cycle as continueWithNextTurn but skip the initial PLANNING transition
        // because we are already there.
        this.state.resume();
        await this.persistence.resumeInterview({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
        });
        const nextTurn = this.state.turnNumber + 1;
        const pick = await this.runPlanning(nextTurn);
        this.transition('ASKING', 'questions_picked', nextTurn);
        const askedAt = this.clock();
        await this.persistAgentTurn(nextTurn, pick, askedAt);
        this.transition('AWAITING_USER', 'questions_sent', nextTurn);
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'AWAITING_USER',
            turnNumber: nextTurn,
            llmCallCount: this.llmCallCount,
        });
        return {
            state: 'AWAITING_USER',
            turnNumber: nextTurn,
            agentMessage: formatAgentMessage(pick),
            satisfactionScore: this.latestRubric?.aggregateScore ?? null,
            criticVerdict: this.criticVerdicts[this.criticVerdicts.length - 1] ?? null,
            handoff: null,
        };
    }
    /**
     * Operator force-close. Surfaces any un-decisioned DECIDE questions as
     * `openUnknowns` with reason='operator_force_close'.
     */
    async forceClose(closedBy, reason = 'operator_force') {
        this.requireStarted();
        if (this.state.state === 'HANDOFF') {
            throw new InterviewerError('force_close_after_terminal', 'cannot force-close after HANDOFF');
        }
        if (this.state.state === 'FORCE_CLOSED')
            return null;
        this.state.forceClose('operator_force_close');
        // Surface un-decisioned DECIDE questions
        const unresolved = this.collectUnresolvedDecide();
        for (const q of unresolved) {
            this.openUnknowns.push({
                pillar: q.pillar,
                question_id: q.id,
                question: q.question,
                suggestedDefault: undefined,
                blocking: q.weight >= 1.2,
                reason: 'operator_force_close',
            });
        }
        const plan = this.accumulator
            ? this.attachFinalMetadata(this.accumulator.getPlan(), null)
            : null;
        await this.persistence.forceClose({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            closeReason: reason,
            closedBy,
        });
        if (plan && this.latestRubric) {
            await this.snapshotRevision(this.state.turnNumber, this.latestRubric, plan);
        }
        return plan;
    }
    // ─────────────────────────────────────────────────────────────────────
    // Snapshot / introspection
    // ─────────────────────────────────────────────────────────────────────
    snapshot() {
        this.requireStarted();
        return {
            id: this.interviewId,
            tenantSlug: this.tenantSlug,
            operatorEmail: this.operatorEmail,
            grandIdeaPrompt: this.grandIdea,
            state: this.state.state,
            turnNumber: this.state.turnNumber,
            turns: [], // populated by persistence.loadInterview if needed
            plan: this.accumulator?.getPlan() ?? null,
            rubric: this.latestRubric,
            criticPasses: [...this.criticVerdicts],
            openUnknowns: [...this.openUnknowns],
            operatorLog: [...this.operatorLog],
            closeReason: null,
            metadata: {
                responderRole: 'founder',
                llmCallCount: this.llmCallCount,
                llmCallBudget: this.llmCallBudget,
                criticPassesRun: this.criticVerdicts.length,
                fatigueOverrides: 0,
                deferralAttempts: { ...this.deferralCounts },
            },
            createdAt: this.clock(),
            updatedAt: this.clock(),
        };
    }
    getState() {
        return this.state.state;
    }
    getTurnNumber() {
        return this.state.turnNumber;
    }
    getLastPick() {
        return this.lastPick;
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — state transitions
    // ─────────────────────────────────────────────────────────────────────
    transition(to: any, reason: any, turn?: any) {
        this.state.transition({
            to,
            reason,
            ...(turn !== undefined ? { turnNumber: turn } : {}),
            at: this.clock(),
        });
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — LLM-driven phases
    // ─────────────────────────────────────────────────────────────────────
    async runInitExtraction() {
        const result = await this.llm.call(initExtractionPrompt(this.grandIdea));
        this.llmCallCount++;
        if (!result.ok) {
            throw new InterviewerError('llm_call_failed', `INIT extraction failed: ${result.diagnostic}`, {
                diagnostic: result.diagnostic,
            });
        }
        const skel = extractJsonObject(result.text) as any;
        // Seed initial sections with the skeleton — confidence 35 so the
        // accumulator scores them low until the founder fills them in.
        const plan = this.accumulator.getPlan();
        let updated = plan;
        const audience = stringOrEmpty(skel.audience);
        const problem = stringOrEmpty(skel.problem);
        const solution = stringOrEmpty(skel.solution);
        const value = stringOrEmpty(skel.hypothesizedValue);
        if (audience) {
            updated = setSection(updated, 'customerICP', {
                ...getSection(updated, 'customerICP'),
                content: `Initial skeleton: ${audience}`,
                confidence: 35,
                decisionedAtTurn: 0,
                pillarsCovered: ['B3'],
            });
        }
        if (problem) {
            updated = setSection(updated, 'problemStatement', {
                ...getSection(updated, 'problemStatement'),
                content: `Initial skeleton: ${problem}`,
                confidence: 35,
                decisionedAtTurn: 0,
                pillarsCovered: ['B5'],
            });
        }
        if (solution) {
            updated = setSection(updated, 'solutionScope', {
                ...getSection(updated, 'solutionScope'),
                content: `Initial skeleton: ${solution}`,
                confidence: 35,
                decisionedAtTurn: 0,
                pillarsCovered: ['B6'],
            });
        }
        if (value) {
            updated = setSection(updated, 'valueProposition', {
                ...getSection(updated, 'valueProposition'),
                content: `Initial skeleton: ${value}`,
                confidence: 35,
                decisionedAtTurn: 0,
                pillarsCovered: ['B5'],
            });
        }
        // Re-seat the accumulator with the seeded plan
        this.accumulator = new BusinessPlanAccumulator(updated, this.playbook);
    }
    async runPlanning(turnNumber) {
        if (!this.accumulator) {
            throw new InterviewerError('invalid_state_transition', 'accumulator not initialized');
        }
        const perPillarCoverage = this.accumulator.computePerPillarCoverage();
        const pick = this.generator.pick({
            turnNumber,
            perPillarCoverage,
            askedIds: this.askedIds,
            deferralCounts: this.deferralCounts,
        });
        this.lastPick = pick;
        for (const p of pick.questions) {
            this.askedIds.add(p.question.id);
        }
        return pick;
    }
    async runIngestion(userReply) {
        const pick = this.lastPick;
        const result = await this.llm.call(ingestExtractionPrompt(pick.questions, userReply));
        this.llmCallCount++;
        if (!result.ok) {
            throw new InterviewerError('llm_call_failed', `INGESTING failed: ${result.diagnostic}`, {
                diagnostic: result.diagnostic,
            });
        }
        const raw = extractJsonObject(result.text) as any;
        return {
            extractions: raw.extractions ?? [],
            unanswered: raw.unanswered ?? [],
        };
    }
    applyExtractions(extractions, turn) {
        if (!this.accumulator)
            return;
        const turnStub = {
            id: this.idFactory(),
            interviewId: this.interviewId,
            turnNumber: turn,
            role: 'user',
            content: '',
            askedAt: this.clock(),
            answeredAt: this.clock(),
            llmCallCount: 0,
        };
        const updates = buildUpdatesFromExtraction(turnStub, extractions.extractions, this.playbook);
        for (const u of updates) {
            this.accumulator.applyUpdate(u);
        }
    }
    async runEvaluation() {
        if (!this.accumulator) {
            throw new InterviewerError('invalid_state_transition', 'accumulator not initialized');
        }
        const result = await this.llm.call(rubricEvaluationPrompt(this.accumulator.getPlan()));
        this.llmCallCount++;
        if (!result.ok) {
            throw new InterviewerError('llm_call_failed', `EVALUATING failed: ${result.diagnostic}`, {
                diagnostic: result.diagnostic,
            });
        }
        const raw = extractJsonObject(result.text) as any;
        return this.accumulator.refreshRubric(raw.dimensions ?? {});
    }
    async runSelfCritique(turn) {
        const passNumber = this.criticVerdicts.length === 0 ? 1 : 2;
        const result = await this.llm.call(selfCritiquePrompt(this.accumulator.getPlan(), passNumber));
        this.llmCallCount++;
        if (!result.ok) {
            throw new InterviewerError('llm_call_failed', `SELF_CRITIQUE failed: ${result.diagnostic}`, { diagnostic: result.diagnostic });
        }
        const raw = extractJsonObject(result.text) as any;
        const askMore = (raw.blowupItems ?? []).filter((b) => b.shipAsIs === false);
        const recommendation = raw.recommendation ?? (askMore.length >= 2 ? 'roll_back' : 'ship_as_is');
        if (recommendation === 'roll_back') {
            // Promote suggested follow-ups into the deferral counts so the
            // generator surfaces them.
            for (const item of askMore) {
                if (item.pillar) {
                    // We don't have specific question ids, just nudge the picker via
                    // deferralCounts. The picker is coverage-driven anyway; this is a
                    // soft hint.
                }
            }
            this.recordOperatorDecision(turn, 'self_critique', 'ship_as_is', 'roll_back', 'self_critic_rollback');
            return false;
        }
        return true;
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — turn cycling
    // ─────────────────────────────────────────────────────────────────────
    async continueWithNextTurn(prevTurn) {
        if (prevTurn >= this.maxTurns) {
            // Soft cap — surface as session_timeout and force-close
            await this.forceClose('system', 'session_timeout');
            return {
                state: this.state.state,
                turnNumber: prevTurn,
                agentMessage: 'We have hit the maximum number of turns for this session. The plan has been handed off as-is — open unknowns will be surfaced to the operator for review.',
                satisfactionScore: this.latestRubric?.aggregateScore ?? null,
                criticVerdict: this.criticVerdicts[this.criticVerdicts.length - 1] ?? null,
                handoff: this.accumulator
                    ? this.attachFinalMetadata(this.accumulator.getPlan(), null)
                    : null,
            };
        }
        if (this.llmCallCount >= this.llmCallBudget) {
            await this.forceClose('system', 'budget_exceeded');
            return {
                state: this.state.state,
                turnNumber: prevTurn,
                agentMessage: 'LLM call budget exhausted. The plan has been handed off as-is — operator review recommended.',
                satisfactionScore: this.latestRubric?.aggregateScore ?? null,
                criticVerdict: this.criticVerdicts[this.criticVerdicts.length - 1] ?? null,
                handoff: this.accumulator
                    ? this.attachFinalMetadata(this.accumulator.getPlan(), null)
                    : null,
            };
        }
        this.transition('PLANNING', 'next_turn');
        const nextTurn = prevTurn + 1;
        const pick = await this.runPlanning(nextTurn);
        this.transition('ASKING', 'questions_picked', nextTurn);
        const askedAt = this.clock();
        await this.persistAgentTurn(nextTurn, pick, askedAt);
        this.transition('AWAITING_USER', 'questions_sent', nextTurn);
        await this.persistence.updateState({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            state: 'AWAITING_USER',
            turnNumber: nextTurn,
            llmCallCount: this.llmCallCount,
        });
        return {
            state: 'AWAITING_USER',
            turnNumber: nextTurn,
            agentMessage: formatAgentMessage(pick),
            satisfactionScore: this.latestRubric?.aggregateScore ?? null,
            criticVerdict: this.criticVerdicts[this.criticVerdicts.length - 1] ?? null,
            handoff: null,
        };
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — persistence helpers
    // ─────────────────────────────────────────────────────────────────────
    async persistAgentTurn(turn, pick, askedAt) {
        await this.persistence.appendTurn({
            id: this.idFactory(),
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            turnNumber: turn,
            role: 'agent',
            content: formatAgentMessage(pick),
            questionIds: pick.questions.map((p) => p.question.id),
            pillarsCovered: [...new Set(pick.questions.map((p) => p.question.pillar))],
            askedAt,
            llmCallCount: 0,
            metadata: { strategy: pick.strategy, clusterTarget: pick.clusterTarget },
        });
    }
    async snapshotRevision(turn: any, rubric: any, override?: any) {
        this.revisionNumber++;
        const plan = override ?? this.accumulator.getPlan();
        await this.persistence.snapshotRevision({
            interviewId: this.interviewId,
            tenantSlug: this.tenantSlug,
            revisionNumber: this.revisionNumber,
            atTurnNumber: turn,
            document: plan,
            rubricScores: rubric,
            satisfactionScore: rubric.aggregateScore,
        });
    }
    recordDeferrals(unanswered, turn) {
        for (const qid of unanswered) {
            const cnt = (this.deferralCounts[qid] ?? 0) + 1;
            this.deferralCounts[qid] = cnt;
            void this.persistence.markDeferred({
                interviewId: this.interviewId,
                tenantSlug: this.tenantSlug,
                questionId: qid,
                askedAtTurn: turn,
                reason: 'user_skipped',
            });
            if (cnt >= 3) {
                const q = this.playbook.byId.get(qid);
                if (q) {
                    // promote to openUnknowns with reason 'deferred_3x'
                    if (!this.openUnknowns.some((u) => u.question_id === qid)) {
                        this.openUnknowns.push({
                            pillar: q.pillar,
                            question_id: q.id,
                            question: q.question,
                            suggestedDefault: undefined,
                            blocking: q.weight >= 1.2,
                            reason: 'deferred_3x',
                        });
                    }
                }
            }
        }
    }
    recordOperatorDecision(turn, decisionField, from, to, rationale) {
        this.operatorLog.push({
            turn,
            responderRole: 'operator',
            decisionField,
            from,
            to,
            rationale,
        });
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — thresholds
    // ─────────────────────────────────────────────────────────────────────
    meetsThreshold(rubric) {
        if (rubric.aggregateScore < this.satisfactionThreshold)
            return false;
        for (const pid of Object.keys(rubric.perPillarCoverage)) {
            const v = rubric.perPillarCoverage[pid];
            if (v < this.pillarFloor)
                return false;
        }
        return true;
    }
    collectUnresolvedDecide() {
        const out = [];
        for (const pillar of this.playbook.bank.pillars) {
            for (const q of pillar.questions) {
                if (q.decision_mode !== 'DECIDE')
                    continue;
                if (this.accumulator?.isDecided(q.id))
                    continue;
                out.push({ id: q.id, pillar: pillar.id, question: q.question, weight: q.weight });
            }
        }
        return out;
    }
    // ─────────────────────────────────────────────────────────────────────
    // Internal — finalize plan with critic + unknowns + operator log
    // ─────────────────────────────────────────────────────────────────────
    attachFinalMetadata(plan, verdict) {
        const final = {
            ...plan,
            openUnknowns: [...this.openUnknowns].map((u) => ({
                pillar: u.pillar,
                question_id: u.question_id,
                question: u.question,
                ...(u.suggestedDefault ? { suggestedDefault: u.suggestedDefault } : {}),
                blocking: u.blocking,
                reason: u.reason,
            })),
            operatorDecisionsLog: [...this.operatorLog],
            ...(verdict !== null ? { criticPass: verdict } : {}),
            lastUpdatedAt: this.clock().toISOString(),
        };
        // Auto-fill executiveSummary if missing
        const summary = composeExecutiveSummary(final);
        return {
            ...final,
            executiveSummary: {
                ...getSection(final, 'executiveSummary'),
                content: summary,
                confidence: 70,
                decisionedAtTurn: this.state.turnNumber,
            },
        };
    }
    // ─────────────────────────────────────────────────────────────────────
    // Guards
    // ─────────────────────────────────────────────────────────────────────
    requireStarted() {
        if (this.interviewId === null) {
            throw new InterviewerError('invalid_state_transition', 'interviewer has not been started');
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────
function formatAgentMessage(pick) {
    const intro = pick.transitionNarration ? `${pick.transitionNarration}\n\n` : '';
    const body = pick.questions
        .map((p, i) => `${i + 1}. ${p.question.question}`)
        .join('\n\n');
    return `${intro}${body}`;
}
function handoffMessage() {
    return 'Thank you — that completes the interview. The business plan has been finalized and is ready for handoff.';
}
function composeExecutiveSummary(plan) {
    const get = (k) => getSection(plan, k).content.split('\n').slice(0, 2).join(' ').trim();
    const fragments = [
        get('problemStatement'),
        get('valueProposition'),
        get('mvpScope'),
        get('businessModel'),
        get('successMetrics'),
    ].filter((s) => s.length > 0);
    if (fragments.length === 0) {
        return 'Executive summary pending — see individual sections for details.';
    }
    return fragments.join(' ');
}
function stringOrEmpty(v) {
    if (typeof v !== 'string')
        return '';
    const trimmed = v.trim();
    if (!trimmed || trimmed.toLowerCase() === 'unknown')
        return '';
    return trimmed;
}
export { businessPlanV2Schema, PILLAR_TO_SECTIONS };
//# sourceMappingURL=interviewer.js.map