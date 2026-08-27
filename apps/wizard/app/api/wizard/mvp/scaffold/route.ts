/**
 * POST /api/wizard/mvp/scaffold
 *
 * Given idea + proposal, returns:
 *   - initiatives: 2-4 high-level goals
 *   - epics: 4-8 mid-level buckets
 *   - screens: 8 proposed MVP screens the user picks 5 from
 *
 * Uses openai/gpt-4o-mini in JSON mode. Fast, cheap, reliable.
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCAFFOLD_SYSTEM = `You are the CAIA MVP Scaffolder. Given a founder's app idea + proposal, produce:
- initiatives: 2-4 high-level product goals (each: name, one-line purpose)
- epics: 4-8 buckets of work under those initiatives (each: name, one-line purpose, initiativeName)
- screens: EXACTLY 8 proposed screens for the MVP click-through, in a sensible user-journey order (each: name (2-4 words), routePath ("/foo"), purpose (one-line), estimatedComplexity ("simple" | "medium"), suggested: true|false — mark 5 as suggested that most impact the demo)

Output JSON only, no preamble/fences:
{
  "productName": "string",
  "initiatives": [{"name":"","purpose":""}],
  "epics": [{"name":"","purpose":"","initiativeName":""}],
  "screens": [{"name":"","routePath":"/","purpose":"","estimatedComplexity":"simple","suggested":true}]
}

Rules:
- Screens must include a home/feed/landing screen as #1 and a settings/profile screen as #8.
- Middle 6 screens are core to the product.
- Suggested=true for exactly 5 screens — pick the ones that make the app feel most alive.
- No jargon: everyday user-goal names ("My Feed", "Post a Recipe", "Neighbor Profile") not tech names ("Feed Component", "Data Table").`;

interface ScaffoldReq { ideaText?: unknown; proposal?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: ScaffoldReq;
  try { body = (await req.json()) as ScaffoldReq; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  const proposal = typeof body.proposal === 'string' ? body.proposal.trim() : '';
  if (ideaText.length < 10) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const userPrompt = `Idea:\n"${ideaText}"\n\nProposal:\n${proposal || '(none)'}\n\nProduce the scaffold JSON now.`;
  const r = await callOpenRouter({
    purpose: 'mvp.scaffold',
    userPrompt,
    systemPrompt: SCAFFOLD_SYSTEM,
    model: 'openai/gpt-4o-mini',
    maxTokens: 1200,
    timeoutMs: 20_000,
    responseFormat: 'json',
    paidFallback: true,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_json' : r.error }, { status: 502 });

  return NextResponse.json(
    { ok: true, ...(r.json as object), model: r.model, costUsd: r.costUsd, latencyMs: Date.now() - started },
    { status: 200 },
  );
}
