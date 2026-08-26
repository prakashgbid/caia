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

const PROPOSAL_SYSTEM = `You are a senior partner at a top-tier seed fund (think YC / a16z / Sequoia Seed) writing a crisp 1-page investor memo about a startup you're recommending your partners fund. Your only input is the founder's grand idea + the transcript of an interview you (or your associate) conducted with them.

Output MUST be markdown and MUST use this exact structure — headings and order fixed:

## <Company name — invent something plausible from the idea, ~2-4 words>
**One-line pitch:** <15 words max, sharp, no fluff>

### Problem
<2-3 sentences. Who hurts, how sharp, how often.>

### Solution
<2-3 sentences. What they build. The wedge. Why now.>

### Market
<TAM/SAM/SOM as honest numbers where possible; if unknown, name the analog market. 2-3 sentences.>

### Business model
<How they charge, expected ACV, unit economics if grounded in the interview.>

### Moat
<Why a copycat in month 6 loses. Concrete.>

### Traction / Go-to-market
<What the founder has already done or plans to do to get first 100 customers. Cost/effort.>

### Team
<From what the interview reveals — founder background, why now.>

### The ask
<How much to raise, use of funds, milestones for the next 18 months.>

### Risks + how they hurt us
<Top 3, with the mitigation the founder gave (or 'unaddressed' if they didn't).>

### Why I'm recommending we fund
<3-4 sentences. Honest. If the interview raised big gaps, name them and say the plan to fill them post-investment.>

Rules:
- No preamble, no "here is your proposal", no chain-of-thought. Start with the ## heading.
- No bullet lists inside sections — narrative sentences only (matches VC memo house style).
- No hedging language. VCs write with conviction; if the founder didn't answer something, say "founder did not address X — flagged as diligence item" rather than inventing.
- Under 250 words total. Absolutely ruthless — every sentence must earn its keep.
- If the interview is very thin (< 3 turns), your Why-I'm-recommending should note that this memo is preliminary and list the top 3 things you'd want to nail down before writing the check.`;

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
