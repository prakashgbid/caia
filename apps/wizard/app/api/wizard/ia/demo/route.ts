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

const IA_SYSTEM = `You are the CAIA Product Architect writing a friendly, plainspoken map of the app CAIA will build for the founder — the person who told us the idea. This is NOT a technical design doc for engineers, NOT a spec review deck. It is a warm, human map that says: 'Here are the pieces of your app, here are the pages people will see, here is how they move around.'

The founder may be a 10-year-old, a retiree, a small-shop owner. Zero business or tech background required. Never use jargon like TAM, CAC, entities-as-schema, ERD, normalization, etc. When you do use a technical word (entity, page, flow), give a warm one-line gloss so the founder feels included.

Output MUST be markdown with these exact sections in this order:

## <Product name — same name the Proposal used if you can, or invent one>

### The things your app keeps track of
<A bulleted list of 5-9 items. Format: **ThingName** — one warm sentence describing what it is in everyday language. Example: '**Recipe** — a dish someone shared with their neighbors, with a photo and a short story.' No sub-bullets.>

### The pages people will see
<A bulleted list of 6-10 items. Format: **/route-name** — one warm sentence about what the person does on this page. Example: '**/feed** — the main scrolling home page where you see what your neighbors cooked today.' Focus on user goals, not routes-as-tech.>

### How people will move through the app
<3-5 numbered stories. Each is one warm sentence: 'As a <person>, when I want to <goal>, I <step1> → <step2> → <step3>.' Example: 'As a home cook, when I want to share a dish, I tap the plus button → take a photo → add a note → post.'>

### A rough map of the data (skip if it feels too technical)
<A short code block with pseudocode field lists — this section is more for us (CAIA) than for you (founder). We include it because it helps us build faster. Format each thing on its own line: 'Recipe: title (text), photo (image), cook (person), created_at (time), likes_count (number)'. No arrows or relationships.>

### What we'll leave out of the first version
<A bulleted list of things the founder mentioned or implied that we'll deliberately hold back for later versions. Each with a warm one-line reason. Example: '**Live video streaming** — cool idea, but we'll do photos first so we can get you in front of users faster.' No judgment tone.>

Rules:
- Start with the ## heading — no preamble, no thinking process.
- Total under 500 words. Warm and inclusive throughout.
- Never use these words: investor, VC, funding, revenue, TAM, CAC, LTV, competition, ERD, normalized, foreign key.
- Every 'thing' in the tracked-list must appear in the data-map. Every page must serve at least one user story.
- If the interview transcript is thin, write '(we'll pick together in the design step)' rather than inventing specifics.`;

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
