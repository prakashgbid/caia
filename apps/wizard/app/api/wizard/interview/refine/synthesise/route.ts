/**
 * POST /api/wizard/interview/refine/synthesise
 *
 * Given the full interview transcript, distill it into a finite, defensible
 * startup statement + coverage report + remaining open questions. This is
 * what downstream stages (business plan, market research, MVP scope) use
 * as their canonical "spec.grandIdea (refined)" input.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface Turn { role: 'assistant' | 'user'; text: string; }
interface Req { grandIdea?: unknown; turns?: unknown; }

const SYSTEM = `You are distilling a founder-interview transcript into a rigorous, finite startup statement. STRICT JSON output only.

{
  "finiteIdea": string (1-2 sentences: what, for whom, and the wedge),
  "elevatorPitch": string (≤ 200 chars, the founder could say it aloud in one breath),
  "who": string (specific persona in one sentence),
  "problem": string (specific pain in one sentence),
  "moment": string (when in their life this hits),
  "currentAlternative": string (what they do today — 1 competitor + 1 workaround + doing-nothing),
  "wedge": string (the ONE thing this does 10x better on day 1),
  "outcome": string (what changes in their life),
  "proof": string[] (2-4 concrete real-world signals the founder mentioned or that are obvious),
  "advantage": string (why THIS founder is well-suited, or why it won't be copied trivially),
  "coverage": {
    "who": 0|1|2|3, "problem": 0|1|2|3, "moment": 0|1|2|3, "currentAlt": 0|1|2|3,
    "wedge": 0|1|2|3, "outcome": 0|1|2|3, "proof": 0|1|2|3, "advantage": 0|1|2|3
  },
  "openQuestions": string[] (0-3 questions the founder still hasn't answered clearly),
  "readinessScore": 0-100 (how ready this is to hand to research + MVP scope),
  "readinessReasoning": string
}

Rules:
- Faithful to what the founder actually said. Do NOT add facts the founder didn't provide.
- If a dimension is still fuzzy, mark low coverage + list it in openQuestions. Never make up a placeholder.
- No filler adjectives ("robust", "innovative", "revolutionary"). Concrete language only.
- If the founder was actually clear across all dimensions, readinessScore ≥ 80.`;

export async function POST(req: Request): Promise<NextResponse> {
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const grandIdea = typeof body.grandIdea === 'string' ? body.grandIdea.trim() : '';
  const turns = Array.isArray(body.turns) ? (body.turns as Turn[]) : [];
  if (grandIdea.length < 15) return NextResponse.json({ ok: false, error: 'idea_too_short' }, { status: 400 });
  if (turns.length < 2) return NextResponse.json({ ok: false, error: 'not_enough_turns' }, { status: 400 });

  const transcript = turns.map((t, i) => `${t.role === 'assistant' ? 'CAIA' : 'FOUNDER'} (${i + 1}): ${t.text}`).join('\n');
  const userPrompt = `FOUNDER'S ORIGINAL IDEA:
"${grandIdea}"

FULL INTERVIEW TRANSCRIPT:
${transcript}

Distill into the JSON now.`;

  const r = await callWithRouting('interview.refiner.synthesise', {
    systemPrompt: SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 3_500,
    timeoutMs: 90_000,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: r.ok ? 'no_json' : r.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...(r.json as object), model: r.model });
}
