/**
 * POST /api/wizard/proposal/demo
 *
 * Generates a 1-page investor-grade business proposal from the founder's
 * grand idea + interview transcript. Runs against OpenRouter free tier
 * per [[openrouter-only]]. Ephemeral — no persistence, demo mode only.
 *
 * The real Proposal generator (@caia/business-proposal-generator with
 * pillar-tracked multi-turn Claude calls + DB persistence + tenant search
 * path) lives at /api/wizard/proposal/generate and requires a real
 * projectId + tenant + DB. That path stays for the paid post-payment
 * side; this route is the demo one-shot.
 *
 * Contract:
 *   Request: { grandIdea: string, transcript: Array<{role,content}> }
 *   Response: { ok: true, proposal: string (markdown), model, costUsd,
 *               latencyMs, generatedAt: ISO }
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROPOSAL_SYSTEM = `You are the CAIA Product Manager writing a warm, plainspoken *build brief* for the founder — the person who told us the idea. This is NOT an investor memo, NOT a fundability assessment, NOT a business plan. It is a friendly one-page document that says: "Here's what we heard, here's what we'll build for you, here's how it will feel."

The founder may be a 10-year-old, a retiree, a small-shop owner, anyone. They are not seeking investment. They are building an app with our help. Never mention investors, VCs, funding, revenue, monetization, market size, competition-as-a-defense, or fundability. If the interview didn't discuss money, don't invent it.

Output MUST be markdown with these exact sections in this order:

## <Product name — invent something plausible from the idea, 2-4 words, feels like a real product name>
**One-line summary:** <one sentence in plain English, ≤20 words, that a friend would understand>

### Who it's for
<2-3 sentences describing the people who will use this in everyday, human language. No jargon, no personas-with-demographics, just: 'People who ...' Focus on the moment they'd need it.>

### What it does
<A short paragraph (3-5 sentences) walking through what a user actually does inside the app — top-to-bottom, everyday-language flow.>

### The key features we'll build
<A bulleted list of 4-7 features. Each bullet: **Feature name** — one-line description of what it does for the user. Concrete, no fluff.>

### What makes this special
<2-3 sentences on what will feel great about this app — the vibe, the moment of delight, the thing users will love. Written from the user's perspective. NOT a competitive analysis.>

### What we'll ship first (MVP)
<A bulleted list of the smallest set of features we can put in front of real users to see if they love it. Usually 3-4 items.>

### What we'll add after that
<A bulleted list of the nice-to-haves that come in v2 or v3. Usually 3-5 items.>

### Rough timeline
<2-3 sentences with a friendly estimate — 'We think we can put a working MVP in front of your first users in about X weeks, and here's roughly how the first month looks.' No Gantt-chart precision, no dev-day estimates.>

### What we'll need from you
<A bulleted list of 3-5 things we'll ask the founder along the way — decisions we'll bring back to them ('what should the button copy say?', 'do you want a dark mode?'), inputs we'll need ('a list of the 10 initial products to seed the catalog'), and moments where they get to review + approve.>

### Ready when you are
<A single warm closing sentence inviting them to keep going. Never 'here's the ask', never 'we recommend investment'. Just: 'Sound good? Let's go build it together' or similar.>

Rules:
- Start with the ## heading — no preamble.
- Total under 350 words. Ruthlessly plain-English.
- Never use the words: investor, VC, funding, revenue, monetize, market size, TAM, CAC, LTV, competition, business model, fundable, ROI, pipeline, KPI.
- No bullet lists inside sections that specify paragraphs (Who it's for, What it does, What makes this special, Rough timeline, Ready when you are).
- If the interview transcript is thin, DO NOT invent specifics. Say '(we'll figure this out together)' instead.`;

interface ProposalRequest {
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
  let body: ProposalRequest;
  try {
    body = (await req.json()) as ProposalRequest;
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
  const transcript = body.transcript;

  const rendered = transcript
    .map((m) => `${m.role === 'user' ? 'FOUNDER' : 'INTERVIEWER'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = `Grand idea (founder's own words):\n\n"${grandIdea}"\n\nInterview transcript (${transcript.length} turns):\n\n${rendered || '(no interview turns yet — synthesize from the grand idea alone and flag gaps.)'}\n\nWrite the 1-page memo now, following the exact structure I gave you in system.`;

  const r = await callOpenRouter({
    purpose: 'proposal.demo.generate',
    userPrompt,
    systemPrompt: PROPOSAL_SYSTEM,
    // Pin minimax-m3:free — same reasoning as interview endpoint.
    model: 'minimax/minimax-m3:free',
    maxTokens: 500,
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

  const proposal = r.text.trim();

  return NextResponse.json(
    {
      ok: true,
      proposal,
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      generatedAt: new Date().toISOString(),
      transcriptTurns: transcript.length,
    },
    { status: 200 },
  );
}
