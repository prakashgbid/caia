/**
 * @caia/interviewer — playbook loader.
 *
 * Parses `skills/playbook/question-templates.json` into the typed
 * `PlaybookBank` shape and builds quick-access indices (by id, by
 * pillar, by horizon, by decision_mode) the QuestionGenerator depends
 * on.
 *
 * The loader is strict: a missing pillar or malformed question record
 * throws `InterviewerError('playbook_parse_error', …)`. This catches
 * playbook regressions at startup rather than mid-interview.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InterviewerError } from './errors.js';
import { DECISION_MODES, HORIZONS, PILLAR_IDS, } from './types.js';
// ─────────────────────────────────────────────────────────────────────────
// File path discovery — works for both dist (compiled) and source ts.
// ─────────────────────────────────────────────────────────────────────────
function defaultPlaybookPath() {
    // src/playbook-loader.ts  → ../skills/playbook/question-templates.json
    // dist/playbook-loader.js → ../skills/playbook/question-templates.json
    const here = dirname(fileURLToPath(import.meta.url));
    return resolvePath(here, '..', 'skills', 'playbook', 'question-templates.json');
}
// ─────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────
function assertString(v, path) {
    if (typeof v !== 'string') {
        throw new InterviewerError('playbook_parse_error', `expected string at ${path}`, { path, got: typeof v });
    }
    return v;
}
function assertNumber(v, path) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new InterviewerError('playbook_parse_error', `expected finite number at ${path}`, { path, got: typeof v });
    }
    return v;
}
function assertArray(v, path) {
    if (!Array.isArray(v)) {
        throw new InterviewerError('playbook_parse_error', `expected array at ${path}`, { path, got: typeof v });
    }
    return v;
}
function isPillarId(v) {
    return PILLAR_IDS.includes(v);
}
function isHorizon(v) {
    return HORIZONS.includes(v);
}
function isDecisionMode(v) {
    return DECISION_MODES.includes(v);
}
// ─────────────────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────────────────
function parseQuestion(raw, path) {
    if (typeof raw !== 'object' || raw === null) {
        throw new InterviewerError('playbook_parse_error', `expected object at ${path}`, { path });
    }
    const r = raw;
    const pillar = assertString(r['pillar'], `${path}.pillar`);
    if (!isPillarId(pillar)) {
        throw new InterviewerError('playbook_parse_error', `unknown pillar ${pillar}`, { path });
    }
    const horizon = assertString(r['horizon'], `${path}.horizon`);
    if (!isHorizon(horizon)) {
        throw new InterviewerError('playbook_parse_error', `unknown horizon ${horizon}`, { path });
    }
    const decisionMode = assertString(r['decision_mode'], `${path}.decision_mode`);
    if (!isDecisionMode(decisionMode)) {
        throw new InterviewerError('playbook_parse_error', `unknown decision_mode ${decisionMode}`, { path });
    }
    return {
        id: assertString(r['id'], `${path}.id`),
        pillar,
        pillar_name: assertString(r['pillar_name'], `${path}.pillar_name`),
        subcategory: assertString(r['subcategory'], `${path}.subcategory`),
        question: assertString(r['question'], `${path}.question`),
        rationale: assertString(r['rationale'], `${path}.rationale`),
        horizon,
        decision_mode: decisionMode,
        weight: assertNumber(r['weight'], `${path}.weight`),
        triggers_followups: assertArray(r['triggers_followups'], `${path}.triggers_followups`).map((x, i) => assertString(x, `${path}.triggers_followups[${i}]`)),
        rejects_answers: assertArray(r['rejects_answers'], `${path}.rejects_answers`).map((x, i) => assertString(x, `${path}.rejects_answers[${i}]`)),
    };
}
function parsePillar(raw, path) {
    if (typeof raw !== 'object' || raw === null) {
        throw new InterviewerError('playbook_parse_error', `expected object at ${path}`, { path });
    }
    const r = raw;
    const id = assertString(r['id'], `${path}.id`);
    if (!isPillarId(id)) {
        throw new InterviewerError('playbook_parse_error', `unknown pillar id ${id}`, { path });
    }
    const questions = assertArray(r['questions'], `${path}.questions`).map((q, i) => parseQuestion(q, `${path}.questions[${i}]`));
    return {
        id,
        number: assertNumber(r['number'], `${path}.number`),
        name: assertString(r['name'], `${path}.name`),
        weight: assertNumber(r['weight'], `${path}.weight`),
        subcategories: assertArray(r['subcategories'], `${path}.subcategories`).map((x, i) => assertString(x, `${path}.subcategories[${i}]`)),
        question_count: assertNumber(r['question_count'], `${path}.question_count`),
        questions,
    };
}
export function parsePlaybookBank(raw) {
    if (typeof raw !== 'object' || raw === null) {
        throw new InterviewerError('playbook_parse_error', 'top-level not an object');
    }
    const r = raw;
    const pillars = assertArray(r['pillars'], 'pillars').map((p, i) => parsePillar(p, `pillars[${i}]`));
    const clusterRules = assertArray(r['cluster_sizes_by_turn'], 'cluster_sizes_by_turn').map((rule, i) => {
        const rr = rule;
        const range = assertArray(rr['turn_range'], `cluster_sizes_by_turn[${i}].turn_range`);
        if (range.length !== 2) {
            throw new InterviewerError('playbook_parse_error', `turn_range must have 2 entries`, { i });
        }
        return {
            turn_range: [
                assertNumber(range[0], `cluster_sizes_by_turn[${i}].turn_range[0]`),
                assertNumber(range[1], `cluster_sizes_by_turn[${i}].turn_range[1]`),
            ],
            questions_per_turn: assertNumber(rr['questions_per_turn'], `cluster_sizes_by_turn[${i}].questions_per_turn`),
            strategy: assertString(rr['strategy'], `cluster_sizes_by_turn[${i}].strategy`),
        };
    });
    const cs = r['cold_start_fixture'];
    if (typeof cs !== 'object' || cs === null) {
        throw new InterviewerError('playbook_parse_error', 'cold_start_fixture missing or invalid');
    }
    const csObj = cs;
    const coldStart = {
        turn_number: assertNumber(csObj['turn_number'], 'cold_start_fixture.turn_number'),
        question_ids: assertArray(csObj['question_ids'], 'cold_start_fixture.question_ids').map((x, i) => assertString(x, `cold_start_fixture.question_ids[${i}]`)),
        rationale: assertString(csObj['rationale'], 'cold_start_fixture.rationale'),
    };
    const momTest = assertArray(r['mom_test_rejection_patterns'], 'mom_test_rejection_patterns').map((mt, i) => {
        const m = mt;
        return {
            pattern: assertString(m['pattern'], `mom_test_rejection_patterns[${i}].pattern`),
            replace_with: assertString(m['replace_with'], `mom_test_rejection_patterns[${i}].replace_with`),
        };
    });
    const horizonMix = r['horizon_mix'];
    const decisionModeMix = r['decision_mode_mix'];
    return {
        version: assertString(r['version'], 'version'),
        schema: assertString(r['schema'], 'schema'),
        total_pillars: assertNumber(r['total_pillars'], 'total_pillars'),
        total_questions: assertNumber(r['total_questions'], 'total_questions'),
        pillars,
        cluster_sizes_by_turn: clusterRules,
        cold_start_fixture: coldStart,
        mom_test_rejection_patterns: momTest,
        horizon_mix: {
            MVP: assertNumber(horizonMix['MVP'], 'horizon_mix.MVP'),
            '1yr': assertNumber(horizonMix['1yr'], 'horizon_mix.1yr'),
            '5yr': assertNumber(horizonMix['5yr'], 'horizon_mix.5yr'),
            nice: typeof horizonMix['nice'] === 'number' ? horizonMix['nice'] : 0,
        },
        decision_mode_mix: {
            DECIDE: assertNumber(decisionModeMix['DECIDE'], 'decision_mode_mix.DECIDE'),
            DEFER: assertNumber(decisionModeMix['DEFER'], 'decision_mode_mix.DEFER'),
        },
        operator_locked: assertString(r['operator_locked'], 'operator_locked'),
    };
}
// ─────────────────────────────────────────────────────────────────────────
// Index builder
// ─────────────────────────────────────────────────────────────────────────
export function buildPlaybookIndex(bank) {
    const byId = new Map();
    const byPillar = new Map();
    const byHorizon = new Map();
    const byDecisionMode = new Map();
    const pillarById = new Map();
    for (const pillar of bank.pillars) {
        pillarById.set(pillar.id, pillar);
        if (!byPillar.has(pillar.id))
            byPillar.set(pillar.id, []);
        for (const q of pillar.questions) {
            if (byId.has(q.id)) {
                throw new InterviewerError('playbook_parse_error', `duplicate question id ${q.id}`, {
                    id: q.id,
                });
            }
            byId.set(q.id, q);
            byPillar.get(pillar.id).push(q);
            const horizonArr = byHorizon.get(q.horizon) ?? [];
            horizonArr.push(q);
            byHorizon.set(q.horizon, horizonArr);
            const dmArr = byDecisionMode.get(q.decision_mode) ?? [];
            dmArr.push(q);
            byDecisionMode.set(q.decision_mode, dmArr);
        }
    }
    return {
        bank,
        byId,
        byPillar,
        byHorizon,
        byDecisionMode,
        pillarById,
    };
}
// ─────────────────────────────────────────────────────────────────────────
// Public loaders
// ─────────────────────────────────────────────────────────────────────────
export async function loadPlaybook(path) {
    const filePath = path ?? defaultPlaybookPath();
    let raw;
    try {
        raw = await readFile(filePath, 'utf8');
    }
    catch (e) {
        throw new InterviewerError('playbook_parse_error', `failed to read playbook at ${filePath}: ${e.message}`, { filePath });
    }
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch (e) {
        throw new InterviewerError('playbook_parse_error', `playbook is not valid JSON: ${e.message}`, { filePath });
    }
    return buildPlaybookIndex(parsePlaybookBank(json));
}
export function loadPlaybookFromObject(obj) {
    return buildPlaybookIndex(parsePlaybookBank(obj));
}
//# sourceMappingURL=playbook-loader.js.map