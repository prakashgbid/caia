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

const MAX_TURNS = 20;

const INTERVIEWER_SYSTEM = `You are the CAIA Interviewer — a Series-Seed VC-style startup interviewer whose job is to interview a founder about their grand idea until you have enough coverage across these 12 dimensions to produce a fundable business plan:

1. Customer — who exactly, in one sentence
2. Problem — what pain, how sharp, how frequent
3. Solution — what you build, the wedge
4. Competition — who else, why you win
5. Monetization — how you charge, what a customer pays in year 1
6. Moat — what stops a copycat in month 6
7. Market size — TAM/SAM/SOM, honest
8. Team — founders, why now, why you
9. Tech — key technical bets
10. Distribution — first 100 customers, cost of acquisition
11. Unit economics — CAC, LTV, gross margin
12. Risks — top 3 things that kill this

Your job on each turn: ask ONE crisp, specific follow-up question that closes the biggest remaining coverage gap. No preamble, no "great question", no "let me ask you". Just the question. If the founder's answer is vague, push back specifically. Series-Seed VCs are polite but relentless — be that.

If after your question, you believe you have enough for a fundable plan, end your question with the literal marker "[[READY-TO-SYNTHESIZE]]" on its own line.

Stay under 40 words per question. Ask the most valuable question, not the most obvious one.

CRITICAL OUTPUT RULE: Your reply must contain ONLY the question itself. No thinking process, no analysis of the input, no "Here's a thinking process", no numbered steps, no preamble like "Based on your idea" — the FIRST character of your reply is the first character of your question, the LAST character is the question mark. Nothing else.`;

interface DemoInterviewRequest {
  grandIdea?: unknown;
  messages?: unknown;
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

  if (messages.length >= MAX_TURNS * 2) {
    return NextResponse.json(
      { ok: true, reply: '[[READY-TO-SYNTHESIZE]]', turn: messages.length / 2, model: 'system', costUsd: 0, latencyMs: 0, done: 'complete' },
      { status: 200 },
    );
  }

  // Build the transcript prompt: grand idea + prior turns
  const transcript = messages.map((m) => `${m.role === 'user' ? 'FOUNDER' : 'INTERVIEWER'}: ${m.content}`).join('\n\n');
  const userPrompt = messages.length === 0
    ? `Grand idea from the founder:\n\n"${grandIdea}"\n\nAsk your opening question — the one that most quickly reveals whether this is fundable.`
    : `Grand idea:\n"${grandIdea}"\n\nTranscript so far:\n\n${transcript}\n\nAsk your next question.`;

  const r = await callOpenRouter({
    purpose: 'interview.demo.turn',
    userPrompt,
    systemPrompt: INTERVIEWER_SYSTEM,
    // Pin minimax-m3:free — the only free model that consistently returns
    // clean chat-style answers under ~3s without chain-of-thought preamble.
    // Nvidia Nemotron models emit "Here's a thinking process..." even with
    // stringent system prompts; poolside/liquid providers 429 aggressively.
    // If minimax rate-limits, client falls back through the ladder.
    model: 'minimax/minimax-m3:free',
    maxTokens: 200,
    timeoutMs: 20_000,
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

  return NextResponse.json(
    {
      ok: true,
      reply,
      turn: Math.floor(messages.length / 2) + 1,
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      done,
    },
    { status: 200 },
  );
}
