/**
 * POST /api/wizard/mvp/screen
 *
 * Generates ONE React screen for the MVP click-through:
 *   { idea, productName, screenName, screenPurpose, allScreens }
 *   → { ok: true, code: string, imports: string[], mockData?: object }
 *
 * The code is a single default-export React functional component using
 * Tailwind classes and mock data hardcoded inline. It renders inside
 * Sandpack's react template.
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCREEN_SYSTEM = `You are the CAIA MVP Screen Generator. Produce a single self-contained React functional component for ONE screen of the MVP click-through prototype.

Constraints (STRICT):
- Output MUST be a JSON object exactly of shape: { "code": "string" }
- The "code" value is a full React module with a default export named ScreenComponent.
- Use ONLY Tailwind utility classes for styling (no imports, no external CSS).
- Use ONLY React + lucide-react icons (already installed in the sandbox — you may import from 'lucide-react').
- No other imports. No fetch, no external APIs.
- Include realistic MOCK DATA inline (arrays/objects at the top of the file).
- Component must be complete and immediately runnable in a Sandpack React template.
- Include tap/click handlers that set local state, so the screen feels interactive.
- Header + main content + footer/bottom-nav structure.
- Mobile-first responsive Tailwind classes.

Example shape of the code value (illustrative — you'll write the actual content):

import { useState } from 'react';
import { Heart, MessageCircle } from 'lucide-react';

const POSTS = [{ id: 1, author: 'Alex', ... }, ...];

export default function ScreenComponent() {
  const [likes, setLikes] = useState({});
  return (
    <div className="min-h-screen bg-white">...</div>
  );
}

Do NOT add code fences. Do NOT add explanation. Output ONLY the JSON object with a single "code" field.`;

interface ScreenReq {
  ideaText?: unknown;
  productName?: unknown;
  screenName?: unknown;
  screenPurpose?: unknown;
  allScreens?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: ScreenReq;
  try { body = (await req.json()) as ScreenReq; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'App';
  const screenName = typeof body.screenName === 'string' ? body.screenName : '';
  const screenPurpose = typeof body.screenPurpose === 'string' ? body.screenPurpose : '';
  const allScreens = Array.isArray(body.allScreens) ? (body.allScreens as Array<{ name: string; routePath: string }>) : [];
  if (screenName.length < 2) return NextResponse.json({ ok: false, error: 'screen_name_required' }, { status: 400 });

  const otherScreens = allScreens.filter((s) => s.name !== screenName).map((s) => `${s.name} (${s.routePath})`).join(', ');
  const userPrompt = `Product: ${productName}
Founder idea: ${ideaText}

Screen to build: **${screenName}**
Purpose: ${screenPurpose}

Other screens in the MVP (for nav context): ${otherScreens || '(none)'}

Write the React component now. Include realistic mock data and interactive local state. Nav links can be plain <a href="/route"> — Sandpack will render them as text.

Output the JSON with "code" now.`;

  const me = await readAuthedUser();
  const SCREEN_COST = 15;
  if (me && me.tokensBalance < SCREEN_COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: SCREEN_COST }, { status: 402 });
  }
  const r = await callOpenRouter({
    purpose: 'mvp.screen.generate',
    userPrompt,
    systemPrompt: SCREEN_SYSTEM,
    model: 'openai/gpt-4o-mini',
    maxTokens: 2500,
    timeoutMs: 30_000,
    responseFormat: 'json',
    paidFallback: true,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_json' : r.error }, { status: 502 });
  const parsed = r.json as { code?: string };
  if (!parsed.code || typeof parsed.code !== 'string') {
    return NextResponse.json({ ok: false, error: 'no_code_returned' }, { status: 502 });
  }

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, SCREEN_COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, $3)", [me.id, -SCREEN_COST, 'spend:screen:' + screenName]);
    newBalance = me.tokensBalance - SCREEN_COST;
  }
  return NextResponse.json({
    ok: true,
    code: parsed.code,
    model: r.model,
    costUsd: r.costUsd,
    latencyMs: Date.now() - started,
    tokensBalance: newBalance,
  });
}
