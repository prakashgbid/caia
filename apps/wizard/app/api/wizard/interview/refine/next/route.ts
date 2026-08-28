/**
 * POST /api/wizard/interview/refine/next
 *
 * Adaptive next-question generator. Given the founder's current idea +
 * prior Q&A turns, decides which dimension of "definable startup" is still
 * fuzziest and asks the highest-yield question to narrow it.
 *
 * We never lead the founder — we ask, they answer. The model's job is
 * to figure out WHAT to ask, not to answer for the founder.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface Turn { role: 'assistant' | 'user'; text: string; }
interface Req {
  grandIdea?: unknown;
  turns?: unknown; // Turn[]
  turnBudget?: unknown; // suggested cap 6-10
}

const SYSTEM = `You are the CAIA Idea Refiner. A founder has come to you with a broad or vague product idea. Your job is to ask the RIGHT next question that pushes them toward a finite, definable, tangible startup — without manipulating or leading them toward any particular answer.

CRITICAL PRINCIPLES — ADAPTATION IS THE HARDEST PART:
- PIVOT DETECTION. Read every founder answer for signs they are describing a DIFFERENT product than the initial idea (different activity, different mechanism, different customer). If you detect a pivot (e.g. the idea said "recipe app" but every answer is about "tennis partners" / "spontaneous activity matching"), you MUST acknowledge it in your NEXT question, gently: "It sounds like the real product you keep describing is finding partners for spontaneous activities — should we make that the new starting point?" Then set dimension: 'who' and reset the coverage vector to reflect the new starting point.
- VAGUE-ANSWER PATTERNS. If the founder says "anyone / everyone / it doesn't matter / anybody" more than once, name the pattern in your NEXT question: "You keep saying 'anyone' — usually the strongest startups pick one specific person first. Can you name one specific person, or should we skip this dimension and mark it fuzzy?" Do NOT keep asking the same abstract 'who' question — offer them the escape.
- CONTRADICTION HANDLING. If a new answer contradicts an earlier one, acknowledge it: "Earlier you said X, now Y — which one is closer to the truth?"
- IF THEY REPEAT THEMSELVES, don't ask again. Move to a different dimension.

CRITICAL PRINCIPLES:
- Neutrality. Never suggest what the answer should be. Never anchor them on a specific number, feature, or persona.
- Highest-yield first. Every question should collapse the largest area of uncertainty. Rank dimensions by which are still fuzziest.
- No stacking. One question at a time. No "and also…" clauses.
- Adaptive. Read the prior turns and pick a NEW dimension unless the founder was evasive on the last one — then rephrase.
- Plain English. No MBA jargon (TAM, CAC, LTV, moat, ICP) unless the founder used it first.
- Warm coach, not investor grilling. Curious, not skeptical.
- Escape hatch. If the founder is ready and the idea is defensible, say so — do NOT invent extra questions.

DIMENSIONS to probe (pick the fuzziest each turn):
  who        — one specific person type this is for (not "everyone")
  problem    — one specific pain (not "the whole space")
  moment     — when in that person's day/week/month this hits
  currentAlt — what they use today to cope (competitor + workaround + doing-nothing)
  wedge      — the ONE thing this app does 10x better than currentAlt, on day 1
  outcome    — what changes in their life if this works
  proof      — 2-3 recent signals it's real (search trends, subreddits, waitlists, willingness to pay)
  advantage  — why THIS founder can build it and it won't be copied trivially

OUTPUT — STRICT JSON:
{
  "question":       string (the actual question to show the founder, ≤ 25 words),
  "dimension":      one of who/problem/moment/currentAlt/wedge/outcome/proof/advantage,
  "whyAsking":      string (one plain-English sentence, shown as a tooltip),
  "answerHint":     string (optional, small hint about the SHAPE of a useful answer, e.g. "a specific persona, not a category"),
  "readyToSynthesise": boolean (true only if you'd stop the interview now — enough clarity across dimensions),
  "coverage": {
    "who": 0|1|2|3, "problem": 0|1|2|3, "moment": 0|1|2|3, "currentAlt": 0|1|2|3,
    "wedge": 0|1|2|3, "outcome": 0|1|2|3, "proof": 0|1|2|3, "advantage": 0|1|2|3
  }
}
Coverage scale: 0 unknown · 1 hinted · 2 stated · 3 sharp.`;

export async function POST(req: Request): Promise<NextResponse> {
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const grandIdea = typeof body.grandIdea === 'string' ? body.grandIdea.trim() : '';
  const turns = Array.isArray(body.turns) ? (body.turns as Turn[]) : [];
  const turnBudget = typeof body.turnBudget === 'number' && body.turnBudget > 0 && body.turnBudget < 20 ? body.turnBudget : 8;
  if (grandIdea.length < 15) return NextResponse.json({ ok: false, error: 'idea_too_short' }, { status: 400 });

  const transcript = turns.map((t, i) => `${t.role === 'assistant' ? 'YOU asked' : 'FOUNDER said'} (${i + 1}): ${t.text}`).join('\n');
  const userPrompt = `FOUNDER'S CURRENT IDEA:
"${grandIdea}"

PRIOR TRANSCRIPT (${turns.length} turns so far, budget ~${turnBudget}):
${transcript || '(none — this is turn 1)'}

Decide the fuzziest dimension. Produce the next-question JSON now.`;

  const r = await callWithRouting('interview.refiner.next', {
    systemPrompt: SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 1_500,
    timeoutMs: 60_000,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: r.ok ? 'no_json' : r.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...(r.json as object), model: r.model });
}
