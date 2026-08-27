/**
 * POST /api/wizard/mvp/scaffold
 *
 * Returns a full MVP hierarchy: initiatives → epics → stories → (implicit) tasks,
 * plus the 8 proposed screens the founder picks 5 from (backward-compatible).
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCAFFOLD_SYSTEM = `You are the CAIA MVP Scaffolder. Given a founder's app idea + proposal, produce a hierarchy the founder can walk through.

Output JSON only, exactly this shape:
{
  "productName": "string",
  "initiatives": [
    {
      "id": "init-1",
      "title": "Recipe Sharing",
      "purpose": "Enable users to post and browse recipes",
      "epics": [
        {
          "id": "epic-1-1",
          "title": "Post a Recipe",
          "purpose": "Let users add their recipes with photo + steps",
          "stories": [
            { "id": "story-1-1-1", "title": "As a home cook I want to add a photo of my dish", "purpose": "Photos drive engagement", "status": "todo" }
          ]
        }
      ]
    }
  ],
  "screens": [
    { "name": "Home Feed", "routePath": "/", "purpose": "...", "estimatedComplexity": "simple", "suggested": true }
  ]
}

Rules:
- 2-4 initiatives.
- 4-8 epics total distributed across initiatives.
- 3-6 stories per epic. Each story format: "As a <persona> I want <goal> so <benefit>" OR a plain user goal.
- Stories status starts "todo".
- ALWAYS include 3 special stories under a "Design" epic (auto-added, initiativeName "Foundation"):
  - "Pick your design system (shadcn/MUI/Chakra/Ant/custom)"
  - "Pick your style guide (minimal/warm/corporate/playful/editorial/brutalist)"
  - "Pick your theme (light/dark/auto)"
- ALWAYS include exactly 8 screens (backward compat with builder UI): #1 home/feed, #8 settings/profile, middle 6 core.
- Screens: 5 marked suggested=true (the most demo-impactful).
- Everyday user-goal names, not tech names. Plain English.`;

interface ScaffoldReq { ideaText?: unknown; proposal?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: ScaffoldReq;
  try { body = (await req.json()) as ScaffoldReq; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  const proposal = typeof body.proposal === 'string' ? body.proposal.trim() : '';
  if (ideaText.length < 10) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const userPrompt = `Idea:\n"${ideaText}"\n\nProposal:\n${proposal || '(none)'}\n\nProduce the scaffold JSON now.`;
  const me = await readAuthedUser();
  const SCAFFOLD_COST = 25;
  if (me && me.tokensBalance < SCAFFOLD_COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: SCAFFOLD_COST }, { status: 402 });
  }
  const r = await callOpenRouter({
    purpose: 'mvp.scaffold.v2',
    userPrompt,
    systemPrompt: SCAFFOLD_SYSTEM,
    model: 'openai/gpt-4o-mini',
    maxTokens: 2500,
    timeoutMs: 30_000,
    responseFormat: 'json',
    paidFallback: true,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_json' : r.error }, { status: 502 });

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, SCAFFOLD_COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:scaffold')", [me.id, -SCAFFOLD_COST]);
    newBalance = me.tokensBalance - SCAFFOLD_COST;
  }
  return NextResponse.json(
    { ok: true, ...(r.json as object), model: r.model, costUsd: r.costUsd, latencyMs: Date.now() - started, tokensBalance: newBalance },
    { status: 200 },
  );
}
