/**
 * POST /api/wizard/mvp/screen
 *
 * Generates one deployable React screen for the MVP click-through.
 * Emits code that:
 *   - Uses react-router-dom for real navigation (Link, useNavigate, useParams)
 *   - Uses React state + localStorage for persistence between screens
 *   - Real form handlers (submit → localStorage + navigate)
 *   - Honors spec.design (design system, style guide, theme, accentColor)
 *   - Tailwind utilities only — no external CSS
 *   - lucide-react for icons
 *
 * All this so that when the founder deploys their MVP click-through the
 * screens actually navigate + persist state, not just render as static components.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SCREEN_SYSTEM = `You are the CAIA MVP Screen Generator. Produce a single deployable React screen for the founder's click-through prototype.

Output MUST be a JSON object exactly of shape: { "code": "string" }

The "code" value is a full React module with a default export named ScreenComponent.

STRICT rules:
- Uses ONLY these imports:
    import React, { useState, useEffect } from 'react';
    import { Link, useNavigate, useParams } from 'react-router-dom';
    import { <IconName>, ... } from 'lucide-react';   // any lucide icons you need
- Uses Tailwind utility classes ONLY for styling (no CSS-in-JS, no imports).
- Honors the DESIGN CONTEXT provided (design system look-and-feel, style guide tone, theme, accent color) in the visual choices you make.
- Persists any user-entered state to localStorage under key \`caia_mvp_<slug>\` where <slug> is the screen route.
- Real form handlers: onSubmit → localStorage.setItem(...) → navigate('/next-route').
- <Link to="/route"> for internal navigation (never <a href>).
- Realistic mock data seeded in a top-level const, ~5-10 items minimum.
- Interactive: at least one useState + one handler that mutates it.
- Component structure: header (with nav Links to other screens in the app), main content (the screen's real function), footer or bottom-nav (for mobile-friendly nav).
- Mobile-first responsive with Tailwind (sm: md: lg: breakpoints).
- Accessibility: aria-labels on interactive elements, semantic HTML.
- No TODO comments, no placeholder text — everything looks intentional.

Output ONLY the JSON — no code fences around it, no preamble.`;

interface ScreenReq {
  ideaText?: unknown; productName?: unknown; screenName?: unknown;
  screenPurpose?: unknown; allScreens?: unknown; design?: unknown;
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
  const design = body.design && typeof body.design === 'object' ? body.design as Record<string, unknown> : {};
  if (screenName.length < 2) return NextResponse.json({ ok: false, error: 'screen_name_required' }, { status: 400 });

  const me = await readAuthedUser();
  const SCREEN_COST = 15;
  if (me && me.tokensBalance < SCREEN_COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: SCREEN_COST }, { status: 402 });
  }

  const designHint = [
    design.designSystem ? `Design system: ${design.designSystem} (mimic its look — spacing, corners, button styles)` : '',
    design.styleGuide ? `Style guide tone: ${design.styleGuide}` : '',
    design.theme ? `Theme: ${design.theme}` : '',
    design.accentColor ? `Accent color: ${design.accentColor} (use for CTAs + highlights)` : '',
    design.fontFamily ? `Font family: ${design.fontFamily}` : '',
    design.radius ? `Corner radius: ${design.radius}` : '',
  ].filter(Boolean).join('\n');

  const otherScreens = allScreens.filter((s) => s.name !== screenName).map((s) => `${s.name} → ${s.routePath}`).join(', ');

  const userPrompt = `Product: ${productName}
Founder idea: ${ideaText}

DESIGN CONTEXT:
${designHint || '(no design choices set — use tasteful defaults)'}

Screen to build: **${screenName}**
Purpose: ${screenPurpose}

Other screens in the MVP (link to these where appropriate):
${otherScreens || '(none)'}

Write the deployable React screen now. Emit the JSON with "code".`;

  const r = await callWithRouting('mvp.screen.generate', {
    systemPrompt: SCREEN_SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 8_000,
    timeoutMs: 120_000,
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
    ok: true, code: parsed.code, model: r.model,
    latencyMs: Date.now() - started, tokensBalance: newBalance,
  });
}
