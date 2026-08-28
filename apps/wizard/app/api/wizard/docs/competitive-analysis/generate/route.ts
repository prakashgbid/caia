/**
 * POST /api/wizard/docs/competitive-analysis/generate
 *
 * Real competitors from web-search — no LLM hallucination. Uses
 * perplexity/sonar-reasoning-pro to find them, then claude-opus-5 to build
 * the feature/positioning matrix + moat analysis.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../../lib/backend/session';
import { query } from '../../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface Req { idea?: unknown; productName?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  if (idea.length < 20) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 40;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  // 1) Discover real competitors + their features via web-searched research
  const researchPrompt = `Discover real, currently-operating competitors to this product. For each, ground everything in a URL. Return JSON:

{
  "directCompetitors": [
    { "name": string, "url": string, "positioning": string, "founded": number|null,
      "fundingUsd": number|null, "lastRoundDate": string|null, "employees": number|null,
      "pricingModel": string, "pricingUsd": string, "features": string[],
      "strengths": string[], "weaknesses": string[], "notablePress": string[] }
  ],
  "indirectCompetitors": [ { "name": string, "url": string, "howTheyOverlap": string } ],
  "alternativeApproaches": string[]
}

Product idea: "${idea}"

At least 5 direct + 3 indirect competitors. All must be real companies operating in 2024-2026. Do not fabricate.`;

  const rp = await callWithRouting('research.competitors', {
    userPrompt: researchPrompt,
    responseFormat: 'json',
    maxTokens: 8_000,
    timeoutMs: 180_000,
  });
  if (!rp.ok) return NextResponse.json({ ok: false, phase: 'research', error: rp.error, models: rp.modelsAttempted }, { status: 502 });
  const research = typeof rp.text === 'string' ? rp.text : JSON.stringify(rp.json);

  // 2) Feature matrix + moat + positioning statement
  const analysisSystem = `You are writing an investor-grade Competitive Analysis (target 3000-4500 words). Rules:

- All competitors named must come from the RESEARCH PACK. Do NOT introduce new companies.
- Every claim about a competitor cites the URL from the pack.
- Include a real markdown table for the feature matrix — rows = competitors, columns = the 6-8 most important feature dimensions for this product.
- Include a text-drawn positioning map (two axes) showing where each competitor sits.
- Sections: Executive Summary, Direct Competitors (one subsection each), Indirect Competitors, Feature Matrix, Positioning Map, Our Moat & Defensibility (specific to the product idea), Positioning Statement.
- Format: pure markdown.`;

  const analysisUser = `Product: ${productName}
Idea: "${idea}"

RESEARCH PACK (JSON):
${research.slice(0, 25_000)}

Write the analysis now.`;

  const rn = await callWithRouting('doc.business-plan.section', {
    systemPrompt: analysisSystem,
    userPrompt: analysisUser,
    maxTokens: 10_000,
    timeoutMs: 180_000,
  });
  if (!rn.ok) return NextResponse.json({ ok: false, phase: 'analysis', error: rn.error, models: rn.modelsAttempted }, { status: 502 });

  const finalMd = `# ${productName} — Competitive Analysis\n\n_Generated ${new Date().toLocaleDateString()} · Real competitors discovered via web search, not LLM hallucination._\n\n---\n\n${rn.text.trim()}\n\n---\n\n## Appendix — Raw Competitor Discovery\n\n\`\`\`json\n${research.slice(0, 12_000)}\n\`\`\`\n`;

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:doc:competitive-analysis')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  return NextResponse.json({
    ok: true, docSlug: 'competitive-analysis', title: `${productName} — Competitive Analysis`,
    format: 'markdown', content: finalMd,
    researchModel: rp.model, analysisModel: rn.model,
    latencyMs: Date.now() - started, wordCount: finalMd.split(/\s+/).length, tokensBalance: newBalance,
  });
}
