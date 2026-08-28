/**
 * POST /api/wizard/mvp/breakdown-enriched
 *
 * Deep MVP breakdown for the founder. Uses claude-opus-5 (elite) to produce
 * Initiatives → Epics → Stories → Tasks with:
 *   - acceptance criteria (Given/When/Then)
 *   - effort estimate in story points (fibonacci: 1/2/3/5/8/13)
 *   - dependency graph (which stories block which)
 *   - priority (MVP / v1.1 / v2 / nice-to-have)
 *   - user-value score (1-5) + tech-risk score (1-5)
 *
 * Returned as strict JSON so the UI can render a data grid + export to
 * Linear/Jira/Trello via a follow-on endpoint.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Req { idea?: unknown; productName?: unknown; proposal?: unknown; design?: unknown; }

const SYSTEM = `You are the CAIA Product Manager. Given a founder's idea + optional proposal, produce a rigorous MVP breakdown as JSON. Every level must be actionable enough for a real dev team to start Monday morning.

Output shape (STRICT JSON, no preamble, no fences):

{
  "productName": string,
  "vision": string (one sentence),
  "principles": string[] (3-5 design principles that guide decisions),
  "successMetrics": [ { "metric": string, "target": string, "why": string } ],
  "nonGoals": string[] (things we explicitly won't build in MVP),
  "initiatives": [
    {
      "id": "init-N",
      "title": string (2-4 words),
      "purpose": string (one sentence),
      "userValue": 1-5,
      "priority": "mvp" | "v1.1" | "v2" | "nice-to-have",
      "epics": [
        {
          "id": "epic-N.M",
          "title": string,
          "purpose": string,
          "priority": "mvp" | "v1.1" | "v2" | "nice-to-have",
          "stories": [
            {
              "id": "story-N.M.K",
              "title": "As a <persona> I want <goal> so <benefit>",
              "purpose": string,
              "acceptanceCriteria": [ "Given ... When ... Then ..." ],
              "effortPoints": 1|2|3|5|8|13,
              "userValue": 1-5,
              "techRisk": 1-5,
              "dependsOn": string[] (array of story ids),
              "tasks": [ { "title": string, "type": "backend" | "frontend" | "design" | "data" | "infra" | "qa" } ]
            }
          ]
        }
      ]
    }
  ],
  "totalEffortPoints": number,
  "recommendedFirstEpic": string (id),
  "recommendedTeamSize": { "eng": number, "design": number, "pm": number, "reasoning": string }
}

Rules:
- 3-5 initiatives.
- 2-4 epics per initiative.
- 3-6 stories per epic.
- 2-5 tasks per story.
- Every story has AT LEAST 3 acceptance criteria in Given/When/Then form.
- Effort points use Fibonacci: 1/2/3/5/8/13.
- Prioritize ruthlessly — the smallest "mvp" slice must fit in ~40-60 story points total.
- Priority "nice-to-have" is fine but keep it distinct from real v1.1.
- No filler adjectives. Concrete features, not marketing copy.`;

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  const proposal = typeof body.proposal === 'string' ? body.proposal : '';
  const design = body.design && typeof body.design === 'object' ? body.design : {};
  if (idea.length < 20) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 60;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  const userPrompt = `Product name: ${productName}
Design context: ${JSON.stringify(design)}
Idea: "${idea}"
Proposal: ${proposal || '(none)'}

Produce the enriched breakdown JSON now.`;

  const r = await callWithRouting('mvp.breakdown.enriched', {
    systemPrompt: SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 14_000,
    timeoutMs: 180_000,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, models: r.modelsAttempted }, { status: 502 });

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:mvp:breakdown')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  return NextResponse.json({
    ok: true, ...(r.json as object),
    model: r.model, latencyMs: Date.now() - started, tokensBalance: newBalance,
  });
}
