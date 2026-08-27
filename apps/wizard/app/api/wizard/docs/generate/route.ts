/**
 * POST /api/wizard/docs/generate
 *
 * Body: { docSlug, projectContext: { idea, proposal, productName?, ...} }
 * Returns: { ok: true, content: string (markdown), title, format }
 *
 * Uses gpt-4o-mini for short docs, mistral-large for long-form. All calls
 * route through @caia/openrouter-client per [[openrouter-only]].
 */

import { NextResponse } from 'next/server';
import { callOpenRouter } from '@caia/openrouter-client';
import { findDoc } from '../../../../../lib/docs/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DocsGenReq {
  docSlug?: unknown;
  projectContext?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: DocsGenReq;
  try { body = (await req.json()) as DocsGenReq; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const docSlug = typeof body.docSlug === 'string' ? body.docSlug : '';
  const context = (body.projectContext && typeof body.projectContext === 'object') ? body.projectContext as Record<string, unknown> : {};
  const doc = findDoc(docSlug);
  if (!doc) return NextResponse.json({ ok: false, error: 'unknown_doc_slug' }, { status: 400 });

  const contextStr = JSON.stringify(context, null, 2).slice(0, 8000);
  const userPrompt = `PROJECT CONTEXT:\n${contextStr}\n\nProduce the document now, in markdown. No preamble, no fences — just the markdown content.`;

  // Long-form docs get the beefier model + more tokens
  const isLong = doc.slug === 'business-plan';
  const r = await callOpenRouter({
    purpose: `docs.generate.${doc.slug}`,
    userPrompt,
    systemPrompt: doc.systemPrompt,
    model: isLong ? 'mistralai/mistral-nemo' : 'openai/gpt-4o-mini',
    maxTokens: isLong ? 8000 : 3500,
    timeoutMs: isLong ? 60_000 : 35_000,
    responseFormat: 'text',
    paidFallback: true,
  });
  if (!r.ok || !r.text) {
    return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_text' : r.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    docSlug: doc.slug,
    title: doc.title,
    format: doc.format,
    content: r.text.trim(),
    model: r.model,
    costUsd: r.costUsd,
    latencyMs: Date.now() - started,
  });
}
