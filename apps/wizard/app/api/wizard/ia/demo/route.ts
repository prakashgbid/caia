/**
 * POST /api/wizard/ia/demo
 *
 * Generates an Information Architecture pack from the grand idea +
 * interview transcript: entity map, page inventory, cross-page user
 * flows, and a data-model draft. Feeds Proposal (Stage 5) and Design
 * (Stage 6).
 *
 * Runs against OpenRouter free tier per [[openrouter-only]]. Ephemeral,
 * demo mode only. Real IA generator with pillar tracking + DB persistence
 * lives under /api/wizard/ia/generate/[projectId] (backend-real path).
 *
 * Contract:
 *   Request: { grandIdea: string, transcript: Array<{role,content}> }
 *   Response: { ok: true, ia: string (markdown), model, costUsd, latencyMs }
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IA_SYSTEM = `You are a senior product architect. Your job: turn a founder's grand idea + interview transcript into a crisp Information Architecture pack that a designer + engineer can act on tomorrow.

Output MUST be markdown with these exact sections in this order:

## Product name
<same 2-4 word name that reads like a real product>

## Entities
<A bulleted list of the core nouns the product manages. Format: **EntityName** — one-line description. Keep to 5-9 entities max. No sub-bullets.>

## Pages
<A bulleted list of every distinct user-facing page in the MVP. Format: **/route/name** — one-line purpose. Keep to 6-10 pages max. No admin/settings unless they're core to the product.>

## User flows
<3-5 numbered flows. Each is a one-sentence narrative: "As a <role>, to <goal>, I <action1> → <action2> → <action3>." No sub-steps.>

## Data model sketch
<A code block with pseudocode field lists for each entity. Format:
Entity: field: type, field: type
No relations arrows, keep flat.>

## Cut for MVP
<Bullet list of what you explicitly leave OUT of the MVP that the founder mentioned or implied. Justify each in half a sentence.>

Rules:
- Start with the ## heading — no preamble.
- Total under 400 words.
- Every entity in Entities must appear in Data model sketch.
- Every page must serve at least one flow.
- If the transcript is thin, say "diligence item" instead of inventing.`;

interface IARequest {
  grandIdea?: unknown;
  transcript?: unknown;
}

function isValidTranscript(t: unknown): t is Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(t)) return false;
  return t.every(
    (x) =>
      x && typeof x === 'object' &&
      ((x as { role?: unknown }).role === 'user' || (x as { role?: unknown }).role === 'assistant') &&
      typeof (x as { content?: unknown }).content === 'string',
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: IARequest;
  try {
    body = (await req.json()) as IARequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const grandIdea = typeof body.grandIdea === 'string' ? body.grandIdea.trim() : '';
  if (grandIdea.length < 10) {
    return NextResponse.json(
      { ok: false, error: 'grandIdea_required', message: 'Pass a >= 10 char grand idea from Stage 2.' },
      { status: 400 },
    );
  }
  if (!isValidTranscript(body.transcript)) {
    return NextResponse.json({ ok: false, error: 'transcript_invalid_shape' }, { status: 400 });
  }

  const rendered = body.transcript
    .map((m) => `${m.role === 'user' ? 'FOUNDER' : 'INTERVIEWER'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = `Grand idea (founder's own words):\n\n"${grandIdea}"\n\nInterview transcript (${body.transcript.length} turns):\n\n${rendered || '(no interview turns yet — infer from the grand idea alone and flag gaps as diligence items.)'}\n\nProduce the IA pack now, following the exact structure I gave you in system.`;

  const r = await callOpenRouter({
    purpose: 'ia.demo.generate',
    userPrompt,
    systemPrompt: IA_SYSTEM,
    model: 'minimax/minimax-m3:free',
    maxTokens: 600,
    timeoutMs: 25_000,
    responseFormat: 'text',
    attributeTraffic: true,
  });

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: 'llm_call_failed', detail: r.error, retryable: r.retryable, modelsAttempted: r.modelsAttempted },
      { status: r.retryable ? 503 : 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      ia: r.text.trim(),
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      generatedAt: new Date().toISOString(),
      transcriptTurns: body.transcript.length,
    },
    { status: 200 },
  );
}
