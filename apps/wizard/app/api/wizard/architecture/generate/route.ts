/**
 * POST /api/wizard/architecture/generate
 *
 * Turns the founder's finite idea + interview summary into a real
 * Information Architecture: data entities (with fields + relationships),
 * routes (URLs + purpose + who-can-access), user permission model,
 * primary user flows, and a screen map (which screens present which entities).
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../lib/backend/session';
import { query } from '../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Req { idea?: unknown; interviewSummary?: unknown; productName?: unknown; }

const SYSTEM = `You are the CAIA Information Architect. Given a finite startup idea + interview summary, produce a rigorous IA plan. STRICT JSON output only:

{
  "entities": [
    {
      "name": string (PascalCase, e.g. "Recipe"),
      "description": string (one sentence),
      "fields": [
        { "name": string (camelCase), "type": "string"|"text"|"int"|"decimal"|"bool"|"datetime"|"json"|"uuid"|"enum"|"relation",
          "required": boolean, "description": string, "enumValues": string[]|null, "relationTo": string|null }
      ],
      "indexes": string[] (optional, list of field names to index)
    }
  ],
  "routes": [
    { "path": string (e.g. "/recipes/[id]"),
      "method": "GET"|"POST"|"PUT"|"DELETE"|"PAGE",
      "purpose": string, "auth": "public"|"authed"|"owner-only"|"admin",
      "primaryEntity": string, "responseShape": string }
  ],
  "permissions": [
    { "role": string, "canDo": string[] (e.g. ["read:Recipe", "write:Recipe:own", "delete:Comment:own"]) }
  ],
  "userFlows": [
    { "name": string, "steps": [ { "actor": string, "action": string, "route": string, "outcome": string } ] }
  ],
  "screenMap": [
    { "screen": string, "route": string, "entitiesShown": string[], "actionsAvailable": string[] }
  ],
  "openQuestions": string[] (dimensions the finite idea + interview didn't cover; empty if fully clear)
}

Rules:
- Faithful to the finite idea + interview summary. Do NOT invent product features beyond what those imply.
- Entities: 3-8 for an MVP. Fields include timestamps + ownership where sensible.
- Routes: cover CRUD for main entities + auth + primary flows. Aim for 12-25.
- Permissions: at least 3 roles typical for the product (e.g. guest / user / owner).
- User flows: 3-6 covering the highest-value journeys.
- Screen map: 5-9 primary screens; each maps to a route + entities it shows.
- If a dimension is under-specified, add to openQuestions rather than fabricating.
- No filler. Concrete, buildable, minimal.`;

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const interviewSummary = typeof body.interviewSummary === 'string' ? body.interviewSummary : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  if (idea.length < 15) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 20;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  const userPrompt = `Product name: ${productName}
Finite idea: "${idea}"

Interview summary (facts the founder confirmed):
${interviewSummary || '(none — use only the finite idea; add gaps to openQuestions)'}

Produce the IA JSON now.`;

  let r = await callWithRouting('architecture.generate', {
    systemPrompt: SYSTEM,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 10_000,
    timeoutMs: 120_000,
  });
  // JSON repair fallback — if the model produced malformed JSON (common with
  // very long IA output), ask a cheaper model to repair the raw text.
  if (!r.ok && r.error && r.error.includes('json parse failed')) {
    // eslint-disable-next-line no-console
    console.warn('[architecture] JSON parse failed, attempting repair');
    const repairPrompt = `The following text was supposed to be strict JSON matching a specific schema, but it has syntax errors. Fix the JSON — do not change the content, only fix the syntax. Return ONLY the valid JSON, no preamble, no fences. The intended schema is: entities[], routes[], permissions[], userFlows[], screenMap[], openQuestions[]. If a required top-level key is missing, add it as an empty array.

RAW OUTPUT:
${r.error.slice(0, 30_000)}`;
    r = await callWithRouting('doc.short', {
      systemPrompt: 'You are a JSON syntax fixer. Return only valid JSON.',
      userPrompt: repairPrompt,
      responseFormat: 'json',
      maxTokens: 12_000,
      timeoutMs: 60_000,
    });
  }
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: r.ok ? 'no_json' : r.error }, { status: 502 });

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:architecture')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }
  return NextResponse.json({ ok: true, ...(r.json as object), model: r.model, latencyMs: Date.now() - started, tokensBalance: newBalance });
}
