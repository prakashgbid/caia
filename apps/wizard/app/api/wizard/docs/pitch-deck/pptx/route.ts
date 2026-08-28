/**
 * POST /api/wizard/docs/pitch-deck/pptx
 *
 * Produces a real .pptx investor deck (10-12 slides) with cover, styled
 * layouts, speaker notes, and brand-coloured titles. Returns the file as
 * application/vnd.openxmlformats-officedocument.presentationml.presentation
 * with Content-Disposition attachment.
 *
 * Two-step:
 *   1) Ask claude-opus-5 to produce a JSON slide outline with title + bullets +
 *      speakerNotes per slide, grounded in project spec.
 *   2) Render the JSON to .pptx via pptxgenjs on the server.
 */

import { NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../../lib/backend/session';
import { query } from '../../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Req { idea?: unknown; productName?: unknown; founderName?: unknown; design?: unknown; research?: unknown; }

const SYSTEM = `You are producing an investor-ready pitch deck for a real founder. Output STRICT JSON only:

{
  "productName": string,
  "tagline": string (≤ 12 words),
  "slides": [
    {
      "type": "cover" | "problem" | "solution" | "market" | "product" | "business_model" | "traction" | "competition" | "gtm" | "team" | "financials_ask" | "vision",
      "title": string (≤ 8 words),
      "subtitle": string (optional, ≤ 15 words),
      "bullets": string[] (3-5 items, ≤ 15 words each, punchy),
      "keyMetric": { "label": string, "value": string } (optional, for stat callouts),
      "speakerNotes": string (2-4 sentences the founder can say aloud)
    }
  ]
}

Rules:
- EXACTLY 10-12 slides in this order: cover, problem, solution, market, product, business_model, traction, competition, gtm, team, financials_ask, vision.
- Punchy, specific copy — ban filler adjectives ("robust", "world-class", "revolutionary").
- Every claim must be grounded in the project spec (or research pack if provided).
- If a slide's data isn't in the spec, use a placeholder like "TBD — talk to founder" instead of inventing.
- Speaker notes are what the founder SAYS, not what appears on the slide.`;

interface SlideOutline {
  type: string; title: string; subtitle?: string;
  bullets?: string[]; keyMetric?: { label: string; value: string };
  speakerNotes?: string;
}
interface DeckOutline { productName: string; tagline: string; slides: SlideOutline[]; }

export async function POST(req: Request): Promise<NextResponse> {
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  const founderName = typeof body.founderName === 'string' ? body.founderName : 'Founder';
  const design = body.design && typeof body.design === 'object' ? body.design as Record<string, unknown> : {};
  const research = typeof body.research === 'string' ? body.research : '';
  if (idea.length < 20) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 30;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  // 1) Ask elite model for the slide JSON
  const userPrompt = `Product: ${productName}
Founder: ${founderName}
Idea: "${idea}"
Design context: ${JSON.stringify(design)}
Research pack: ${research ? research.slice(0, 8000) : '(none provided — use spec + safe defaults)'}

Produce the deck JSON now.`;

  const r = await callWithRouting('doc.pitch-deck', {
    systemPrompt: SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 6_000,
    timeoutMs: 90_000,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_json' : r.error }, { status: 502 });
  const outline = r.json as DeckOutline;

  // 2) Render to .pptx
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = founderName;
  pptx.title = productName + ' — Pitch Deck';
  const accent = (design.accentColor as string) || '4F46E5';
  const accentHex = accent.startsWith('#') ? accent.slice(1) : accent;
  const brandBg = 'FFFFFF';
  const textDark = '0F172A';
  const textMuted = '475569';
  const fontFace = 'Inter';

  for (let idx = 0; idx < outline.slides.length; idx++) {
    const sl = outline.slides[idx];
    const slide = pptx.addSlide();
    slide.background = { color: brandBg };

    if (sl.type === 'cover') {
      // Cover slide: giant title + tagline + brand accent bar
      slide.addShape('rect', { x: 0, y: 0, w: 0.4, h: 7.5, fill: { color: accentHex } });
      slide.addText(outline.productName || productName, { x: 0.9, y: 2.2, w: 12, h: 1.6, fontSize: 60, bold: true, color: textDark, fontFace });
      slide.addText(outline.tagline || sl.subtitle || '', { x: 0.9, y: 3.9, w: 12, h: 1.0, fontSize: 22, color: textMuted, fontFace });
      slide.addText(founderName + ' · ' + new Date().toLocaleDateString(), { x: 0.9, y: 6.7, w: 8, h: 0.4, fontSize: 12, color: textMuted, fontFace });
    } else {
      // Content slide: colored top bar + title + bullets/keyMetric
      slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: accentHex } });
      slide.addText(sl.title || '', { x: 0.5, y: 0.5, w: 12, h: 0.9, fontSize: 32, bold: true, color: textDark, fontFace });
      if (sl.subtitle) {
        slide.addText(sl.subtitle, { x: 0.5, y: 1.35, w: 12, h: 0.5, fontSize: 16, italic: true, color: textMuted, fontFace });
      }
      if (sl.keyMetric) {
        slide.addText(sl.keyMetric.value, { x: 0.5, y: 2.2, w: 6, h: 2.0, fontSize: 72, bold: true, color: accentHex, fontFace });
        slide.addText(sl.keyMetric.label, { x: 0.5, y: 4.2, w: 6, h: 0.8, fontSize: 16, color: textMuted, fontFace });
      }
      if (sl.bullets && sl.bullets.length > 0) {
        const bulletX = sl.keyMetric ? 7.0 : 0.5;
        const bulletW = sl.keyMetric ? 5.5 : 12;
        slide.addText(sl.bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 20, color: textDark, fontFace, valign: 'top' as const } })), {
          x: bulletX, y: 2.2, w: bulletW, h: 5.0, fontFace, paraSpaceAfter: 10,
        });
      }
    }
    if (sl.speakerNotes) slide.addNotes(sl.speakerNotes);
  }

  // Write to Buffer
  const buffer = await (pptx as unknown as { write: (o: { outputType: string }) => Promise<ArrayBuffer> })
    .write({ outputType: 'arraybuffer' });

  // 3) Ledger
  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:doc:pitch-deck-pptx')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  const filename = `${productName.toLowerCase().replace(/\s+/g, '-')}-pitch-deck.pptx`;
  return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'x-tokens-balance': String(newBalance ?? ''),
      'x-model': r.model,
    },
  });
}
