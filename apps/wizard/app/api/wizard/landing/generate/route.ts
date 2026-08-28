/**
 * POST /api/wizard/landing/generate
 *
 * Produces a full single-file HTML landing page for the founder's app,
 * given the grand idea + proposal markdown. Uses openai/gpt-4o-mini for
 * speed. The HTML is self-contained (inline CSS, no external deps except
 * Google Fonts + Tailwind CDN for utility classes).
 *
 * Response:
 *   { ok: true, html: string, model, costUsd, latencyMs }
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { callWithRouting } from '../../../../../lib/ai/call-with-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANDING_SYSTEM = `You are the CAIA Landing Page Generator. Given a founder's app idea + short build brief, you produce a beautiful, modern single-file HTML landing page for that app.

Requirements:
- ONE valid HTML5 document, self-contained. Includes <html>, <head>, <body>.
- Use Tailwind via CDN (<script src="https://cdn.tailwindcss.com"></script>) and Google Fonts Inter for typography.
- Include: sticky header with logo + primary CTA, hero section (headline + subhead + email-capture or CTA button), 3-6 feature cards, a testimonial-style social-proof block (with plausible-sounding invented names — mark it clearly as "sample"), FAQ (3 items), and a footer.
- Use warm gradients, generous whitespace, rounded corners, subtle shadows.
- Copy MUST be warm, plainspoken, no VC/investor/CAC/LTV jargon.
- MUST work on mobile (responsive Tailwind classes).
- Dark background OR light — pick whichever suits the app's tone.
- Product name comes from the brief. If none, invent a plausible 2-4 word name.

Output ONLY the raw HTML. No markdown fences, no preamble, no explanation. First character of your response is "<" (from <!DOCTYPE). Last character is ">" (from </html>).`;

interface LandingRequest {
  ideaText?: unknown;
  proposal?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: LandingRequest;
  try {
    body = (await req.json()) as LandingRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const ideaText = typeof body.ideaText === 'string' ? body.ideaText.trim() : '';
  const proposal = typeof body.proposal === 'string' ? body.proposal.trim() : '';
  if (ideaText.length < 10) {
    return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });
  }

  const userPrompt = `Founder's idea:\n"${ideaText}"\n\nProposal / build brief:\n${proposal || '(no proposal yet — infer from the idea and produce a great generic landing based on it.)'}\n\nGenerate the single-file HTML landing page now.`;

  const r = await callWithRouting('landing.generate', {
    userPrompt,
    systemPrompt: LANDING_SYSTEM,
    responseFormat: 'text',
  });

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: 'llm_failed', detail: r.error, retryable: r.retryable },
      { status: r.retryable ? 503 : 502 },
    );
  }

  // Strip potential ``` fences the model might have added despite instructions
  let html = r.text.trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Guard: if it doesn't start with <, wrap it as HTML text
  if (!html.startsWith('<')) {
    html = `<!DOCTYPE html><html><body><pre>${html.replace(/</g, '&lt;')}</pre></body></html>`;
  }

  return NextResponse.json(
    {
      ok: true,
      html,
      model: r.model,
      costUsd: r.costUsd,
      latencyMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    },
    { status: 200 },
  );
}
