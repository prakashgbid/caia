/**
 * @caia/interviewer/test-support — fixtures + scripted-founder personas
 * used by integration tests AND by downstream consumers (apps/dashboard,
 * CLI REPL) for smoke tests.
 *
 * The two personas roughly mirror examples.md in the playbook skill:
 *
 *   • Alice / ConsentLane — clear B2B SaaS thesis with sourced answers.
 *     Converges in ~10-12 turns with rubric ≥ 82 and critic 'meeting'.
 *
 *   • Bob / GreenZap — vague consumer thesis. Plateaus around 60-70 in
 *     rubric, demonstrates self-critique rollback and 'pass_kind' critic.
 *
 * Both personas are deterministic: they emit the same reply for any
 * question shape that maps to a known pillar+subcategory.
 */
import { ScriptedLlmCaller } from './llm.js';
import { PILLAR_TO_SECTIONS } from './types.js';
/** Cycle through this persona's replies — returns the next reply text. */
export class ScriptedFounder {
    persona;
    callCounts = new Map();
    constructor(persona) {
        this.persona = persona;
    }
    replyFor(pillars) {
        if (pillars.length === 0)
            return this.persona.genericReply;
        const fragments = [];
        for (const pillar of pillars) {
            const choices = this.persona.pillarReplies[pillar];
            if (!choices || choices.length === 0)
                continue;
            const idx = (this.callCounts.get(pillar) ?? 0) % choices.length;
            fragments.push(choices[idx]);
            this.callCounts.set(pillar, (this.callCounts.get(pillar) ?? 0) + 1);
        }
        return fragments.length === 0 ? this.persona.genericReply : fragments.join('\n\n');
    }
}
const DEFAULT_CRITIC_MEETING = {
    recommendation: 'meeting',
    top5DecisionFactors: [
        { factor: 'Sharp wedge', quote: 'wedge is concrete', sentiment: 'positive' },
        { factor: 'Sourced TAM', quote: 'cited bottom-up', sentiment: 'positive' },
        { factor: 'Named ICP', quote: 'mid-market HR', sentiment: 'positive' },
        { factor: 'Pricing committed', quote: '$29 self-serve', sentiment: 'positive' },
        { factor: 'Premortem present', quote: '5 failure modes', sentiment: 'positive' },
    ],
    meetingQuestions: [
        'How will you reach the first 100 ICP-fit accounts?',
        'What is the kill criterion at month 6?',
    ],
    blockers: [],
};
export class PersonaLlm {
    persona;
    playbook;
    rubricMaturesAtTurn;
    criticVerdict;
    callCount = 0;
    turnNumber = 0;
    constructor(opts) {
        this.persona = new ScriptedFounder(opts.persona);
        this.playbook = opts.playbook;
        this.rubricMaturesAtTurn = opts.rubricMaturesAtTurn ?? 8;
        if (opts.criticVerdict !== undefined) {
            this.criticVerdict = {
                recommendation: opts.criticVerdict.recommendation,
                top5DecisionFactors: opts.criticVerdict.top5DecisionFactors,
                meetingQuestions: opts.criticVerdict.meetingQuestions,
                blockers: opts.criticVerdict.blockers,
            };
        }
        else {
            this.criticVerdict = DEFAULT_CRITIC_MEETING;
        }
    }
    async call(prompt, _opts) {
        void _opts;
        this.callCount++;
        if (prompt.includes('You are a senior startup consultant initializing an interview')) {
            // INIT extraction
            return ok(JSON.stringify({
                audience: 'Mid-market HR leaders, 200-1000 employees, US/EU.',
                problem: 'Compliance evidence collection is fragmented across 7 tools.',
                solution: 'Single audit-ready evidence vault that ingests from those 7 tools.',
                hypothesizedValue: 'Save 40 hours/quarter and pass SOC2 audit on first attempt.',
            }));
        }
        if (prompt.includes('You are a senior startup consultant ingesting a founder')) {
            // INGESTING — parse question ids from prompt and emit per-pillar replies
            const questionIds = this.extractQuestionIds(prompt);
            const pillars = new Set();
            const extractions = questionIds.map((qid) => {
                const q = this.playbook.byId.get(qid);
                if (q)
                    pillars.add(q.pillar);
                const reply = q ? this.persona.replyFor([q.pillar]) : 'I don\'t know yet';
                const confidence = q && this.shouldAnswerConfidently(q.horizon) ? 85 : 50;
                return { questionId: qid, answerSummary: reply.slice(0, 280), confidence };
            });
            void pillars;
            return ok(JSON.stringify({
                extractions,
                unanswered: [],
                contradictions: [],
            }));
        }
        if (prompt.includes('You are evaluating a startup business plan against an investor-grade rubric')) {
            // EVALUATING — produce a rubric. Score climbs with turns.
            this.turnNumber++;
            const mature = this.turnNumber >= this.rubricMaturesAtTurn;
            const base = mature ? 5 : 2;
            const dims = {
                internalConsistency: base,
                decisionDensity: base,
                buildability: base + (mature ? 1 : 0),
                scopeFiniteness: base,
                audienceFocus: base + (mature ? 1 : 0),
                riskAwareness: mature ? 5 : 2,
                marketEvidence: mature ? 5 : 2,
                horizonDiscipline: mature ? 5 : 2,
                investability: mature ? 5 : 2,
            };
            return ok(JSON.stringify({
                dimensions: dims,
                weakestSections: mature ? [] : ['marketOpportunity', 'unitEconomics'],
                oneLineRationale: mature
                    ? 'Plan is investor-ready: sharp ICP, defended pricing, premortem present.'
                    : 'Several sections still aspirational; need decision density and cited market evidence.',
            }));
        }
        if (prompt.includes('You are a skeptical Product Manager reviewing this business plan')) {
            // SELF_CRITIQUE
            return ok(JSON.stringify({
                blowupItems: [
                    {
                        item: 'GTM concentration risk on a single channel',
                        rationale: 'If LinkedIn outbound stalls, no backup pipeline exists.',
                        shipAsIs: true,
                    },
                    {
                        item: 'Vendor dependency on third-party audit tool API',
                        rationale: 'Their API has rate-limited us before; need cache plan.',
                        shipAsIs: true,
                    },
                ],
                recommendation: 'ship_as_is',
            }));
        }
        if (prompt.includes('Output STRICT JSON, no prose, no markdown fences')) {
            // CRITIC PASS
            return ok(JSON.stringify(this.criticVerdict));
        }
        // Unrecognized prompt — fail-loud so test surfaces it
        return {
            ok: false,
            text: '',
            durationMs: 0,
            diagnostic: `PersonaLlm: unrecognized prompt (preview: ${prompt.slice(0, 80)})`,
            modelUsed: 'persona',
        };
    }
    totalCalls() {
        return this.callCount;
    }
    extractQuestionIds(prompt) {
        const matches = prompt.matchAll(/\bid=([A-Z0-9-]+)/g);
        const out = [];
        for (const m of matches) {
            out.push(m[1]);
        }
        return out;
    }
    shouldAnswerConfidently(_h) {
        return true; // current personas all answer confidently; subclass to vary
    }
}
function ok(text) {
    return { ok: true, text, durationMs: 1, diagnostic: null, modelUsed: 'persona' };
}
// ─────────────────────────────────────────────────────────────────────────
// Concrete personas
// ─────────────────────────────────────────────────────────────────────────
export const ALICE_CONSENTLANE = {
    name: 'alice-consentlane',
    grandIdea: 'Compliance evidence collection for mid-market SaaS teams. Single audit-ready vault that ingests from Okta, GitHub, Datadog, AWS, 1Password, Linear, and Notion. Sells to RevOps + Security at HR-tech / fintech companies with 200-1000 employees.',
    pillarReplies: {
        B1: [
            'Subscription, per-seat with a base platform fee. Public list pricing on the website at launch: $29/user/month, base $499/month. We will publish prices.',
            'Annual contracts with quarterly billing. 10% discount on annual prepay. Stripe Billing for collection.',
        ],
        B2: [
            'TAM bottom-up: 50,000 US mid-market SaaS companies × $20K ACV = $1B. Top-down: G2 reports $4B compliance SaaS in 2025. SAM cut to US + UK: $800M. SOM in year 1: 1% = $8M.',
            'Why-now: SOC2 audits are now table-stakes for B2B SaaS deals — 80% of mid-market deals require evidence in 2026.',
        ],
        B3: [
            'Primary persona: Director of Security at 200-1000 employee SaaS company. Age 32-45. Reports to CTO or CISO. Authority to buy up to $50K/year without further approval. Reads Bytes, Tigerblood.',
            'Buyer = Security Director. User = the security engineers + compliance analysts (typically 1-3 per company).',
            'JTBD: When I am preparing for an audit cycle, I want a single source of evidence so I can ship the audit in 2 weeks instead of 6.',
        ],
        B4: [
            'Direct competitors: Vanta (vanta.com/pricing), Drata (drata.com/pricing), Secureframe (secureframe.com/pricing). All at $7-15K/year base.',
            'Wedge: integration depth — we cover 47 SaaS apps vs. Vanta\'s 23. Differentiation dimension: feature depth on integrations.',
            'Five Forces: rivalry HIGH, buyer power MEDIUM (switching cost from Vanta is ~6 weeks of re-mapping), supplier power LOW.',
        ],
        B5: [
            'Problem: Security teams burn 40 hours/quarter chasing evidence across 7 tools. Cost: ~$8K in labor per quarter per company.',
            'UVP: We help mid-market security teams pass audits faster by ingesting evidence from 47 integrations so they get audit-ready in 2 weeks.',
            'Anti-tagline: "AI-powered compliance" — that\'s what everyone says.',
        ],
        B6: [
            'MVP features (5): (1) OAuth-based ingest from 7 sources, (2) evidence vault with audit trail, (3) SOC2 control mapping UI, (4) Slack export, (5) auditor-shareable read-only links. No more, no less.',
            'Success criterion: 100 weekly active users by week 6 with ≥ 60% returning week 2-on-2.',
            'Kill criterion: < 40 paid customers by month 6.',
        ],
        B7: [
            'One-year features (5): SOC2 Type II evidence, ISO 27001 control set, dev-team self-serve onboarding, audit-firm portal, custom controls. Most are gated on hitting the MVP success criterion.',
            'Year 5: $50M ARR, 80 employees, market position #4 behind Vanta / Drata / Secureframe.',
        ],
        B8: [
            'Stack: TypeScript + Next.js + Postgres on AWS. Single monolithic deploy. Auth via Clerk; payments via Stripe.',
            'Latency p95 budget: 800ms for evidence-vault page renders.',
        ],
        B9: [
            'Acceptable downtime: 60 minutes/quarter. Datadog for observability; GitOps deploys via GitHub Actions.',
        ],
        B10: [
            'Brand voice: clear, no-jargon, slightly self-deprecating. Adjectives: precise, audited, low-drama. Anti-pattern: not "AI-powered transformative compliance experience."',
        ],
        B11: [
            'Content strategy: 2 long-form posts per month aimed at "first SOC2 audit" search intent. Target keywords: "soc2 evidence collection", "vanta alternative", "compliance vault".',
        ],
        B12: [
            'CAC target: $4,000. LTV: $30,000 (gross). Payback: 11 months. Gross margin: 78%.',
            'Capital: $1.5M seed already raised. 18 months runway. Series A target: $8M at $30M post.',
        ],
        B13: [
            'Team: 4 engineers, 1 designer, 1 founder, 1 customer-success. Hiring 2 more engineers in year 1.',
        ],
        B14: [
            'GDPR + CCPA from day 1. WCAG AA accessibility. Data residency: EU customers stored in eu-west-1, US in us-east-1.',
        ],
        B15: [
            'Premortem failure modes (5): (1) Vanta drops price 50%, (2) third-party API breakage, (3) we mis-classify a control and a customer fails audit, (4) auditor firm refuses our portal, (5) GTM channel concentration on LinkedIn outbound.',
        ],
        B16: [
            'North-star metric: weekly active audit-ready customers. Threshold bands: week 6 good=80 great=120, month 6 good=300 great=500. PMF method: Sean Ellis 40% test at month 3.',
        ],
    },
    genericReply: 'Let me think about that — I will get back to you with a sourced answer.',
};
export const BOB_GREENZAP = {
    name: 'bob-greenzap',
    grandIdea: 'An app that helps people be more environmentally friendly. We want everyone to use it. We are going to disrupt sustainability.',
    pillarReplies: {
        B1: ['Honestly, not sure yet. Probably ads. Maybe a subscription. We will figure it out.'],
        B2: ['Sustainability is huge — trillions of dollars. Everyone wants to be green.'],
        B3: ['People who care about the environment. Everyone, really.'],
        B4: ['I don\'t know if there are direct competitors. We are unique.'],
        B5: ['Climate change is bad. People want to help.'],
        B6: ['MVP: an app with everything you need to be sustainable. AI-powered recommendations.'],
        B7: ['Year 5: we are the leading sustainability app globally.'],
        B8: ['React Native + Firebase. Easy.'],
        B9: ['Should be fine.'],
        B10: ['Friendly, green, positive vibes.'],
        B11: ['TikTok marketing. Influencers.'],
        B12: ['Burn rate ~$15K/month. No revenue yet.'],
        B13: ['Just me right now. Looking for a technical co-founder.'],
        B14: ['Will figure out legal later.'],
        B15: ['Could fail if we don\'t get traction.'],
        B16: ['Downloads. Lots of downloads.'],
    },
    genericReply: 'I will think about that and circle back.',
};
export { ScriptedLlmCaller };
export { PILLAR_TO_SECTIONS };
//# sourceMappingURL=test-support.js.map