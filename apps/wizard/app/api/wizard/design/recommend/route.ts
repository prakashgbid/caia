/**
 * POST /api/wizard/design/recommend
 *
 * Given the founder's idea + optional target-audience hint, recommend a
 * design system + style guide + theme with justification.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../lib/ai/call-with-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Req { idea?: unknown; audienceHint?: unknown; }

const SYSTEM = `You are a product-design advisor. Given a founder's idea, recommend the best design system, style guide, and theme. Return JSON:

{
  "recommendation": {
    "designSystem": "shadcn" | "mui" | "chakra" | "ant" | "custom",
    "styleGuide":   "minimal" | "warm" | "corporate" | "playful" | "editorial" | "brutalist",
    "theme":        "light" | "dark" | "auto",
    "accentColorHex": string,
    "fontFamily":   "inter" | "geist" | "satoshi" | "system",
    "radius":       "sm" | "md" | "lg" | "full"
  },
  "reasoning": string (2-3 sentences on why these fit the product + audience),
  "alternatives": [
    { "choice": string, "reasoning": string, "whenToPick": string }
  ]
}

Consider audience, use-case (consumer vs SaaS vs internal), tone (serious vs playful), and delivery surface (web vs mobile). Justify with concrete reasoning, not marketing fluff.`;

export async function POST(req: Request): Promise<NextResponse> {
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const audienceHint = typeof body.audienceHint === 'string' ? body.audienceHint : '';
  if (idea.length < 10) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const r = await callWithRouting('mvp.design.recommend', {
    systemPrompt: SYSTEM,
    userPrompt: `Idea: "${idea}"\nAudience hint: ${audienceHint || '(unspecified)'}\n\nReturn the JSON now.`,
    responseFormat: 'json',
    maxTokens: 2_000,
    timeoutMs: 45_000,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...(r.json as object), model: r.model });
}
