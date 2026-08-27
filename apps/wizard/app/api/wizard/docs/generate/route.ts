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
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

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

  // Server-side token gate (only if authed). Anonymous users are allowed
  // to try — they burn their client-side 50-token starter allowance which
  // will run out and force them into the login gate.
  const me = await readAuthedUser();
  const DOC_COST = doc.slug === 'business-plan' ? 25 : 8;
  if (me) {
    if (me.tokensBalance < DOC_COST) {
      return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: DOC_COST }, { status: 402 });
    }
  }

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
  // Deduct tokens for authed users.
  let newBalance: number | undefined = undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, DOC_COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, $3)", [me.id, -DOC_COST, 'spend:doc:' + doc.slug]);
    newBalance = me.tokensBalance - DOC_COST;
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
    tokensBalance: newBalance,
  });
}
