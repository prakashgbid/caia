/**
 * POST /api/wizard/intake/analyze
 *
 * Reads a founder's freeform idea text, scores each of the 10 template
 * slots by (a) whether the text answers it and (b) how confidently, and
 * returns the filled slots + a list of gap questions with pre-generated
 * multiple-choice options for the ones the text didn't cover.
 *
 * Contract:
 *   POST { ideaText: string }
 *   → 200 {
 *       ok: true,
 *       filledSlots: { [name]: { value, confidence } },
 *       gaps: [{ slotName, label, question, kind, options: string[], enumOptions?: string[] }],
 *       gapCount, totalSlots, requiredGapCount,
 *       productWorkingName,   // an invented name if we can guess one
 *       industryDetected,     // one of the enum values or 'unknown'
 *       model, costUsd, latencyMs,
 *     }
 *
 * Uses the paid guarantee model (mistral-nemo) — reliability > cost for
 * this one-per-intake call, and template-matching demands structured JSON.
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { IDEA_TEMPLATE, CONFIDENCE_THRESHOLD, type IdeaSlot } from '../../../../../lib/intake/template.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLOT_SPECS = IDEA_TEMPLATE.map((s) => {
  const enumHint = s.enumOptions ? ` (one of: ${s.enumOptions.join(', ')})` : '';
  return `- ${s.name} (${s.required ? 'required' : 'optional'}, ${s.kind}${enumHint}): ${s.label}`;
}).join('\n');

const ANALYZER_SYSTEM = `You are the CAIA Intake Analyzer. You read a founder's freeform idea text and extract structured information against a fixed template of 10 slots.

The 10 slots (in order):
${SLOT_SPECS}

For each slot, output ONLY a value + confidence pair. Keep values SHORT (under 20 words per freeform slot; under 5 items per list slot).
- value: extracted value, or null if not addressed. For freeform_list slots, output an array. For enum slots, output one of the enum options verbatim, or null.
- confidence: 0.0-1.0. 1.0 = explicit. 0.7-0.9 = strongly implied. 0.4-0.6 = weakly implied. Under 0.3 = null value.

Output MUST be valid JSON with EXACTLY this shape (no extra keys, no explanation):
{
  "name": "string (2-4 word product name inferred from the idea)",
  "slots": {
    "vision": { "value": null, "confidence": 0.0 },
    "problem": { "value": null, "confidence": 0.0 },
    "target_users": { "value": null, "confidence": 0.0 },
    "industry": { "value": null, "confidence": 0.0 },
    "must_have_features": { "value": null, "confidence": 0.0 },
    "nice_to_have_features": { "value": null, "confidence": 0.0 },
    "tone": { "value": null, "confidence": 0.0 },
    "inspirations": { "value": null, "confidence": 0.0 },
    "success_metric": { "value": null, "confidence": 0.0 },
    "known_risks": { "value": null, "confidence": 0.0 }
  }
}

Rules:
- ONLY output the JSON. No preamble, no chain-of-thought, no markdown fences.
- Never invent content the text doesn't support. If unsure, set value=null and confidence low.
- For enum slots, if the founder used a synonym (e.g., "social media app" → "Social / community"), map it and note high confidence.
- For freeform_list slots, split obvious lists ("photos, comments, likes" → three items). Only include items the founder actually mentioned.`;


interface AnalyzerRequest {
  ideaText?: unknown;
}

interface AnalyzerSlot {
  value: string | string[] | null;
  confidence: number;
}

interface AnalyzerJson {
  name?: string;
  slots?: Record<string, AnalyzerSlot>;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: AnalyzerRequest;
  try {
    body = (await req.json()) as AnalyzerRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  if (ideaText.length < 15) {
    return NextResponse.json(
      { ok: false, error: 'idea_too_short', message: 'Please write at least a couple sentences about your idea.' },
      { status: 400 },
    );
  }

  // Step 1: run analyzer LLM
  const analyzerPrompt = `Founder's idea text:\n\n"${ideaText}"\n\nAnalyze it against the 10-slot template and output the JSON.`;
  // Use openai/gpt-4o-mini specifically — it returns structured JSON much
  // faster than mistral-nemo (typical 2-4s vs 15-25s for same output). This
  // stays under Cloudflare's tunnel timeout. Cost is ~\\$0.0005 per call,
  // still negligible. paidFallback:false because we've already pinned a paid
  // model and the free-tier ladder is slow for JSON.
  const analyzerCall = await callOpenRouter({
    purpose: 'intake.analyze.extract',
    userPrompt: analyzerPrompt,
    systemPrompt: ANALYZER_SYSTEM,
    model: 'openai/gpt-4o-mini',
    maxTokens: 500,
    timeoutMs: 20_000,
    responseFormat: 'json',
    paidFallback: true,
  });

  if (!analyzerCall.ok || !analyzerCall.json) {
    return NextResponse.json(
      { ok: false, error: 'analyzer_failed', detail: analyzerCall.ok ? 'no_json' : analyzerCall.error },
      { status: 502 },
    );
  }
  const parsed = analyzerCall.json as AnalyzerJson;
  const rawSlots = parsed.slots ?? {};
  const productWorkingName = typeof (parsed as { name?: string }).name === 'string' ? (parsed as { name: string }).name : 'Your app';
  // industryDetected derived from filled slot value if present, else 'unknown'
  const industryDetected = typeof rawSlots.industry?.value === 'string' ? rawSlots.industry.value : 'unknown';

  // Step 2: normalize slots + compute gaps
  const filledSlots: Record<string, { value: string | string[] | null; confidence: number }> = {};
  const gapSlots: IdeaSlot[] = [];
  for (const slot of IDEA_TEMPLATE) {
    const s = rawSlots[slot.name];
    const value = s?.value ?? null;
    const confidence = typeof s?.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0;
    filledSlots[slot.name] = { value, confidence };
    if (value == null || confidence < CONFIDENCE_THRESHOLD) {
      gapSlots.push(slot);
    }
  }

  // Step 3: return gap descriptors WITHOUT the MC options — the client
  // fires /options requests in parallel for each gap after this endpoint
  // returns. This keeps /analyze under the ~7s Cloudflare tunnel window;
  // parallel option gen from the client adds ~5-8s regardless of gap count.
  const gaps = gapSlots.map((slot) => ({
    slotName: slot.name,
    label: slot.label,
    question: slot.questionTemplate,
    kind: slot.kind,
    required: slot.required,
    options: [] as string[],  // populated by /api/wizard/intake/options
    enumOptions: slot.enumOptions ?? undefined,
  }));
  const requiredGapCount = gaps.filter((g) => g.required).length;

  return NextResponse.json(
    {
      ok: true,
      filledSlots,
      gaps,
      gapCount: gaps.length,
      requiredGapCount,
      totalSlots: IDEA_TEMPLATE.length,
      productWorkingName,
      industryDetected,
      model: analyzerCall.model,
      costUsd: analyzerCall.costUsd,
      latencyMs: Date.now() - started,
    },
    { status: 200 },
  );
}
