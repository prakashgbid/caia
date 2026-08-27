/**
 * POST /api/wizard/interview/demo
 *
 * Lightweight demo-mode interview endpoint. Runs the founder through a
 * live multi-turn interview about their grand idea using @caia/openrouter-client
 * against free-tier OpenRouter models. Ephemeral — no persistence, tenant
 * context comes from the disabled-mode demo tenant.
 *
 * Real (persistent, multi-tenant, pillar-tracked) interviewer lives at
 * /api/wizard/interview/answer and requires a real projectId + tenant + DB.
 * That path stays; this one exists so the public demo tour has a genuinely
 * interactive stage 2 experience without needing infra to be provisioned.
 *
 * Contract:
 *   Request body: {
 *     grandIdea: string,           // required, from Stage 1
 *     messages: Array<{ role: 'user'|'assistant', content: string }>,
 *   }
 *   Response: {
 *     ok: true,
 *     reply: string,               // the next interviewer question
 *     turn: number,                // 1-indexed turn count after this reply
 *     model: string,               // which OpenRouter model served it
 *     costUsd: number,
 *     latencyMs: number,
 *     done: false | 'complete',    // 'complete' hint when interviewer thinks it has enough
 *   }
 *
 * The interviewer system prompt is tuned for a Series-Seed VC style
 * conversation covering the 12 dimensions from [[caia-master-blueprint]]:
 * customer, problem, solution, competition, monetization, moat, market
 * size, team, tech, distribution, unit economics, risks.
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TURNS = 8;              // hard cap — force-end at this many
const SOFT_WRAP_UP_TURN = 5;      // start winding down after this many

const INTERVIEWER_SYSTEM = `You are the CAIA Product Coach. Your job is to have a warm, curious, encouraging conversation with someone about an app or product they want to build. CAIA will build it for them — so you only need to understand the vision well enough that we can start.

You are NOT a VC. NOT an investor. NOT evaluating fundability. NOT a startup consultant. You never interrogate, never judge, never make anyone defend their idea. You are a supportive collaborator — think a friendly product manager sitting next to them, sketching on a whiteboard together.

The person you are talking to may be a 10-year-old with a great idea. They may have zero business or tech background. That is totally fine. Never ask questions that require expertise they might not have.

## What to ask about
- Their vision — what do they see when they picture using this app?
- Their spark — what made them think of this? What gap did they notice in their own life?
- Their users — who does this help, and how does it help them in everyday moments?
- Their must-haves — what is the ONE thing this app absolutely needs to do to feel done?
- Their nice-to-haves — what would make it even more delightful later?
- Their tone — should the app feel playful, professional, calming, energetic?
- Their inspirations — is there an app or website they love that we can borrow feel from?

## What to NEVER ask about
- Market size, TAM, SAM, SOM, CAGR
- Revenue model, pricing, monetization, ads, subscriptions (unless the user brings it up first)
- Investors, funding, VCs, seed rounds, runway, valuation, fundraising
- Team, co-founders, hiring, why-you (unless the user brings it up)
- Competition, moat, differentiation as a defense-of-idea (you can ask "have you seen anything like this you love?" — but never "why will you win?")
- Traction, validation, whether they have proof, whether they have talked to customers
- Business plan, unit economics, CAC, LTV, gross margin

## When the user says "I don't know" or "I need help"
This is normal and welcome. Do NOT ask the same question again in a slightly different form (that IS interrogation). Instead:
- Reassure: "No problem at all — that's exactly what we'll figure out together."
- OR offer a menu: "Would you like this to feel more like Instagram, more like a spreadsheet, or something else?"
- OR skip to a different topic entirely.

## Tone rules
- Warm, curious, celebratory of the idea. "I love that." "That's a great instinct." "Nice — tell me more."
- Every 2-3 turns, briefly reflect back what you're hearing: "So it sounds like you want X — is that right?" Confirmation, not challenge.
- Under 30 words per question. Kids-eye reading level. Zero jargon.
- One question at a time. Never a compound question.
- Never say the words: investor, VC, funding, revenue, monetize, market, TAM, competition, business plan, fundable.

## When to end (say [[READY-TO-SYNTHESIZE]])
This conversation should be SHORT. Aim for 5-8 total turns from you (not 15, not 20). Founders come here to build, not to talk.

- Turns 1-3: opening questions about the vision + spark + core users
- Turns 4-5: dig into the ONE most important feature and one nice-to-have
- Turn 6+: WRAP UP. Reflect back what you heard, then end with the [[READY-TO-SYNTHESIZE]] marker on its own line.
- If the founder ever says "I'm ready", "I don't know anything else", "let's move on", "show me what you have", or anything similar — END IMMEDIATELY on that turn with [[READY-TO-SYNTHESIZE]].
- If the founder gives thin answers (I don't know) 2 turns in a row — WRAP UP on the next turn with what you have. Do not keep fishing.

The [[READY-TO-SYNTHESIZE]] marker must appear on its own line at the end of your final message. Format:
    <your warm final reflection here>
    [[READY-TO-SYNTHESIZE]]

Being wrong about ending early is much better than being wrong about ending late. If in doubt, wrap up.

## CRITICAL output format
Your reply must contain ONLY the question or reflection itself. No preamble, no "thinking process", no numbered analysis steps, no "Based on what you said". The first character of your reply is the first character of the message. The last character is the punctuation. Nothing else. If you want to reflect back and then ask, do it in one flowing sentence, not two paragraphs.`;

interface DemoInterviewRequest {
  grandIdea?: unknown;
  messages?: unknown;
  stickyModel?: unknown;
}

function isValidMessages(m: unknown): m is Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(m)) return false;
  return m.every(
    (x) =>
      x && typeof x === 'object' &&
      (x as { role?: unknown }).role !== undefined &&
      ((x as { role: string }).role === 'user' || (x as { role: string }).role === 'assistant') &&
      typeof (x as { content?: unknown }).content === 'string',
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: DemoInterviewRequest;
  try {
    body = (await req.json()) as DemoInterviewRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const grandIdea = typeof body.grandIdea === 'string' ? body.grandIdea.trim() : '';
  if (grandIdea.length < 10) {
    return NextResponse.json(
      { ok: false, error: 'grandIdea_required', hint: 'Pass a >= 10 char grand idea from the previous step.' },
      { status: 400 },
    );
  }
  if (!isValidMessages(body.messages)) {
    return NextResponse.json({ ok: false, error: 'messages_invalid_shape' }, { status: 400 });
  }
  const messages = body.messages;

  // Force-complete once we hit the hard cap. messages.length counts BOTH
  // user + assistant messages, so 2*MAX_TURNS entries = MAX_TURNS assistant
  // turns already emitted.
  const assistantTurnsSoFar = messages.filter((m) => m.role === 'assistant').length;
  if (assistantTurnsSoFar >= MAX_TURNS) {
    return NextResponse.json(
      {
        ok: true,
        reply: "Thanks — I have plenty to work with. Let's head to the next step and see what CAIA builds for you.\n\n[[READY-TO-SYNTHESIZE]]",
        turn: assistantTurnsSoFar + 1,
        model: 'system',
        costUsd: 0,
        latencyMs: 0,
        done: 'complete',
        maxTurns: MAX_TURNS,
      },
      { status: 200 },
    );
  }

  // Build the transcript prompt: grand idea + prior turns
  const transcript = messages.map((m) => `${m.role === 'user' ? 'FOUNDER' : 'INTERVIEWER'}: ${m.content}`).join('\n\n');
  const userPrompt = messages.length === 0
    ? `Grand idea from the founder:\n\n"${grandIdea}"\n\nAsk your opening question — the one that most quickly reveals whether this is fundable.`
    : `Grand idea:\n"${grandIdea}"\n\nTranscript so far:\n\n${transcript}\n\nAsk your next question.`;

  const stickyModel = typeof body.stickyModel === 'string' && body.stickyModel.trim() !== ''
    ? body.stickyModel.trim()
    : undefined;

  const r = await callOpenRouter({
    purpose: 'interview.demo.turn',
    userPrompt,
    systemPrompt: INTERVIEWER_SYSTEM,
    // Slot 1 default = minimax-m3:free (clean chat responder). Client
    // auto-appends a paid guarantee (mistral-nemo) so we never 502.
    model: 'minimax/minimax-m3:free',
    // Keep multi-turn conversations on the SAME model as turn 1 for
    // tone/style consistency. Passed back by the client from meta.model
    // of the previous turn.
    stickyModel,
    maxTokens: 250,
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

  // Extract just the question. Free-tier models often prepend their
  // reasoning chain ("Here's a thinking process:", "1. Analyze...", etc.)
  // before the actual question. Take everything from the last "?" backwards
  // to the last sentence boundary as the question. Fallback: full text.
  let reply = r.text.trim();
  const doneMarker = '[[READY-TO-SYNTHESIZE]]';
  const done: false | 'complete' = reply.includes(doneMarker) ? 'complete' : false;
  reply = reply.replace(doneMarker, '').trim();
  // Strip leading "thinking process" / numbered-step scaffolding
  const scaffoldPatterns = [
    /^Here'?s? a? thinking process:?[\s\S]*?(?=[A-Z][^\n]*\?)/i,
    /^\d+\.\s+\*\*[\s\S]*?(?=[A-Z][^\n]*\?)/,
    /^Let me[\s\S]*?(?=[A-Z][^\n]*\?)/i,
    /^Based on[\s\S]*?(?=[A-Z][^\n]*\?)/i,
    /^(?:Analysis|Thinking|Reasoning|Plan):[\s\S]*?(?=[A-Z][^\n]*\?)/i,
  ];
  for (const pat of scaffoldPatterns) {
    const trimmed = reply.replace(pat, '').trim();
    if (trimmed.length > 5 && trimmed.length < reply.length) {
      reply = trimmed;
      break;
    }
  }
  // If reply still ends past a question mark, cut at the last one so
  // trailing commentary is dropped
  const lastQ = reply.lastIndexOf('?');
  if (lastQ >= 0 && lastQ < reply.length - 1 && reply.length - lastQ > 50) {
    reply = reply.slice(0, lastQ + 1);
  }
  reply = reply.trim();

  const currentTurn = assistantTurnsSoFar + 1;
  return NextResponse.json(
    {
      ok: true,
      reply,
      turn: currentTurn,
      maxTurns: MAX_TURNS,
      // Hint to the UI: after this turn we're in the wrap-up zone.
      wrapUpSoon: currentTurn >= SOFT_WRAP_UP_TURN,
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      done,
    },
    { status: 200 },
  );
}
