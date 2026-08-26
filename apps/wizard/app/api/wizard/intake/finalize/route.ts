/**
 * POST /api/wizard/intake/finalize
 *
 * Consumes the original idea text + any gap-fill answers and produces
 * Stage A: a quick warm summary card the founder can confirm or tweak
 * before we kick off Stage B (the deep multi-artifact generation).
 *
 * Contract:
 *   POST {
 *     ideaText: string,
 *     filledSlots: { name: { value, confidence } },
 *     gapAnswers: { slotName: string | string[] },
 *   }
 *   → 200 {
 *     ok: true,
 *     productName: string,
 *     summaryCard: string (markdown),
 *     completedTemplate: { name: { value, source: 'analyzer'|'user'|'inferred' } },
 *     model, costUsd, latencyMs,
 *   }
 */

import { NextResponse } from 'next/server';
import { callOpenRouter, PAID_GUARANTEE_MODEL } from '@caia/openrouter-client';
import { IDEA_TEMPLATE, allSlotNames } from '../../../../../lib/intake/template.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUMMARY_SYSTEM = `You are the CAIA Summary Writer. You produce a warm one-page card that reflects back to the founder what CAIA understood from their intake, before we go build.

Structure (fixed order):

## <Product name — 2-4 words, warm>

**In one sentence:** <what it is, ≤ 20 words, everyday language>

### Here's what we heard
<A short warm paragraph (3-4 sentences) reflecting the founder's vision, the problem, and who it helps. Written like a friend recapping their idea back to them.>

### The must-haves you gave us
<Bulleted list of the founder's must-have features. Each bullet: **Feature** — one-line description in their words / paraphrased warmly.>

### The nice-to-haves for later
<Bulleted list of nice-to-haves if any. If none, skip this section entirely.>

### How it should feel
<One sentence about the tone / vibe. Skip if not provided.>

### Ready when you are
<A single warm closing sentence inviting them to keep going. Never mention money, funding, VCs, revenue.>

Rules:
- Start with the ## heading — no preamble.
- Total under 250 words.
- Never use: investor, VC, funding, revenue, TAM, market size, CAC, competition-as-defense, business plan, KPI.
- If a slot value is null or missing, just skip it — do not say "not provided".
- Reflect the founder's own words back where possible (their language, not corporate-speak).`;

interface FinalizeRequest {
  ideaText?: unknown;
  filledSlots?: unknown;
  gapAnswers?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: FinalizeRequest;
  try {
    body = (await req.json()) as FinalizeRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  const filled = (body.filledSlots as Record<string, { value: string | string[] | null; confidence: number }>) ?? {};
  const answers = (body.gapAnswers as Record<string, string | string[]>) ?? {};

  if (ideaText.length < 15) {
    return NextResponse.json({ ok: false, error: 'idea_too_short' }, { status: 400 });
  }

  // Merge: analyzer-filled + user gap answers → completedTemplate
  const completedTemplate: Record<string, { value: string | string[] | null; source: string }> = {};
  for (const name of allSlotNames()) {
    const userAns = answers[name];
    if (userAns !== undefined && userAns !== null && userAns !== '') {
      completedTemplate[name] = { value: userAns, source: 'user' };
    } else if (filled[name]?.value != null) {
      completedTemplate[name] = { value: filled[name].value, source: 'analyzer' };
    } else {
      completedTemplate[name] = { value: null, source: 'inferred' };
    }
  }

  // Build a compact prompt for the summary writer
  const slotLines = IDEA_TEMPLATE.map((s) => {
    const v = completedTemplate[s.name]?.value;
    if (v == null) return null;
    const rendered = Array.isArray(v) ? v.join(', ') : String(v);
    return `- ${s.label}: ${rendered}`;
  })
    .filter(Boolean)
    .join('\n');

  const userPrompt = `Original founder text:\n\n"${ideaText}"\n\nStructured slots (analyzer + founder gap answers merged):\n\n${slotLines}\n\nWrite the summary card now.`;

  const r = await callOpenRouter({
    purpose: 'intake.finalize.summary',
    userPrompt,
    systemPrompt: SUMMARY_SYSTEM,
    model: PAID_GUARANTEE_MODEL,
    maxTokens: 600,
    timeoutMs: 25_000,
    responseFormat: 'text',
    paidFallback: true,
  });

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: 'summary_failed', detail: r.error, retryable: r.retryable },
      { status: r.retryable ? 503 : 502 },
    );
  }

  const summaryCard = r.text.trim();
  // Extract product name from the first ## line
  const nameMatch = /^##\s+(.+)$/m.exec(summaryCard);
  const productName = nameMatch ? nameMatch[1]!.trim() : 'Your app';

  return NextResponse.json(
    {
      ok: true,
      productName,
      summaryCard,
      completedTemplate,
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    },
    { status: 200 },
  );
}
