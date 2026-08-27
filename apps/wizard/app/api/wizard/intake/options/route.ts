/**
 * POST /api/wizard/intake/options
 *
 * Generates 4 multiple-choice options for a single gap slot. Called
 * once per gap by the client, in parallel, after the /analyze endpoint
 * returns the list of gaps. Splitting analysis + option generation into
 * separate endpoints keeps each request under the ~7s Cloudflare tunnel
 * timeout.
 *
 * Contract:
 *   POST { slotName, ideaText, productWorkingName? }
 *   → 200 { ok: true, slotName, options: string[4], model, costUsd, latencyMs }
 *
 * For enum-kind slots, returns the static enum options and skips the LLM
 * call (near-zero cost).
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { getSlot } from '../../../../../lib/intake/template.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPTIONS_SYSTEM = `You are the CAIA Gap-Question Option Generator. For a specific missing slot in a founder's idea intake, generate 4 plausible multiple-choice options they might pick from. The 5th option "Enter my own answer" is added by the UI — do not include it.

Rules:
- Output MUST be a JSON array of exactly 4 strings.
- Each option ≤ 30 words. Concrete, everyday-language, warm.
- Options should span the plausible space (not 4 near-duplicates).
- Options should be SPECIFIC to the founder's idea — reference their product / vision where it helps.
- No preamble, no fences — just the JSON array.`;

interface OptionsRequest {
  slotName?: unknown;
  ideaText?: unknown;
  productWorkingName?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: OptionsRequest;
  try {
    body = (await req.json()) as OptionsRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const slotName = typeof body.slotName === 'string' ? body.slotName : '';
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  const productWorkingName = typeof body.productWorkingName === 'string' ? body.productWorkingName : 'Your app';
  const slot = getSlot(slotName);
  if (!slot) {
    return NextResponse.json({ ok: false, error: 'unknown_slot' }, { status: 400 });
  }
  if (ideaText.length < 15) {
    return NextResponse.json({ ok: false, error: 'idea_too_short' }, { status: 400 });
  }

  // Enum: return static options, skip LLM
  if (slot.kind === 'enum' && slot.enumOptions) {
    return NextResponse.json(
      {
        ok: true,
        slotName,
        options: [...slot.enumOptions].slice(0, 4),  // first 4 shown as MC; user can pick "Enter my own" for others
        model: 'static',
        costUsd: 0,
        latencyMs: Date.now() - started,
      },
      { status: 200 },
    );
  }

  const userPrompt = `Founder's idea text:\n"${ideaText}"\n\nProduct working name: ${productWorkingName}\n\nSlot: ${slot.label}\nInstructions: ${slot.optionSeedPrompt}\n\nOutput the JSON array of 4 options now.`;

  const r = await callOpenRouter({
    purpose: 'intake.options.generate',
    userPrompt,
    systemPrompt: OPTIONS_SYSTEM,
    model: 'openai/gpt-4o-mini',
    maxTokens: 300,
    timeoutMs: 15_000,
    responseFormat: 'json',
    paidFallback: true,
  });

  if (!r.ok || !r.json || !Array.isArray(r.json)) {
    // Graceful fallback: generic 4 options so the UI still renders
    return NextResponse.json(
      {
        ok: true,
        slotName,
        options: [
          'Something small and simple to start',
          'Something familiar, like an app I already use',
          "I'm not sure yet",
          "Something totally new that doesn't exist",
        ],
        model: 'fallback',
        costUsd: 0,
        latencyMs: Date.now() - started,
      },
      { status: 200 },
    );
  }
  const arr = (r.json as unknown[]).filter((x): x is string => typeof x === 'string');
  while (arr.length < 4) arr.push('Not sure yet');
  return NextResponse.json(
    {
      ok: true,
      slotName,
      options: arr.slice(0, 4),
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: Date.now() - started,
    },
    { status: 200 },
  );
}
