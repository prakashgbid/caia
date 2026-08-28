/**
 * POST /api/wizard/docs/market-research/generate
 *
 * Real market-research report grounded in web-searched 2024-2026 data.
 * Uses perplexity/sonar-reasoning-pro (native web-search) for the research
 * pack, then claude-opus-5 to synthesize the narrative. Every claim cited.
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
  const COST = 50;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  // 1) RESEARCH via WebSearch model
  const researchPrompt = `Perform market research for this product idea. Return a JSON object with these keys, every claim citing a URL:

{
  "industryOverview": { "description": string, "totalMarketUsd": number, "sources": string[] },
  "tam": { "usd": number, "definition": string, "sources": string[] },
  "sam": { "usd": number, "definition": string, "sources": string[] },
  "som": { "usd": number, "definition": string, "sources": string[] },
  "growthCagr": { "percent": number, "horizon": string, "sources": string[] },
  "topCompetitors": [
    { "name": string, "url": string, "positioning": string, "fundingUsd": number|null, "employees": number|null, "notablePress": string[] }
  ],
  "customerSegments": [ { "name": string, "sizeUsd": number, "personas": string[], "willingnessToPay": string } ],
  "keyTrends": [ { "trend": string, "impact": string, "source": string } ],
  "geographies": [ { "region": string, "sizeUsd": number, "growthPct": number, "notes": string } ],
  "regulations": [ { "name": string, "jurisdiction": string, "url": string, "implication": string } ],
  "recentDeals": [ { "company": string, "round": string, "amountUsd": number, "date": string, "source": string } ],
  "risks": [ { "risk": string, "severity": "low"|"medium"|"high", "mitigation": string } ]
}

Product idea: "${idea}"

Ground everything in real 2024-2026 data. Do NOT fabricate. If a number is not verifiable, return null with a _note field explaining why.`;

  const rp = await callWithRouting('research.market', {
    userPrompt: researchPrompt,
    responseFormat: 'json',
    maxTokens: 10_000,
    timeoutMs: 240_000,
  });
  if (!rp.ok) return NextResponse.json({ ok: false, phase: 'research', error: rp.error, models: rp.modelsAttempted }, { status: 502 });
  const research = typeof rp.text === 'string' ? rp.text : JSON.stringify(rp.json);

  // 2) NARRATIVE synthesis
  const narrativeSystem = `You are writing an investor-grade Market Research Report (target 4000-6000 words). Rules:

- Every quantitative claim MUST cite a URL from the RESEARCH PACK.
- No filler adjectives. Concrete numbers > vague ranges.
- Sections (use H2 for each): Executive Summary, Industry Overview, Market Sizing (TAM/SAM/SOM), Growth Trends, Competitive Landscape (with feature/positioning matrix), Customer Segments & Personas, Geographic Analysis, Regulatory Landscape, Recent Funding Activity, Key Risks & Mitigations, Sources (numbered).
- All data grounded in RESEARCH PACK. No invented facts.
- Format: pure markdown, no code fences (except for the numbered Sources block).`;

  const narrativeUser = `Product: ${productName}
Idea: "${idea}"

RESEARCH PACK (JSON):
${research.slice(0, 30_000)}

Write the report now.`;

  const rn = await callWithRouting('doc.business-plan.section', {
    systemPrompt: narrativeSystem,
    userPrompt: narrativeUser,
    maxTokens: 15_000,
    timeoutMs: 240_000,
  });
  if (!rn.ok) return NextResponse.json({ ok: false, phase: 'narrative', error: rn.error, models: rn.modelsAttempted }, { status: 502 });

  const finalMd = `# ${productName} — Market Research Report\n\n_Generated ${new Date().toLocaleDateString()} · Grounded in real 2024-2026 data with cited sources._\n\n---\n\n${rn.text.trim()}\n\n---\n\n## Appendix — Research Pack (raw)\n\n\`\`\`json\n${research.slice(0, 12_000)}\n\`\`\`\n`;

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:doc:market-research')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  return NextResponse.json({
    ok: true, docSlug: 'market-research', title: `${productName} — Market Research Report`,
    format: 'markdown', content: finalMd,
    researchModel: rp.model, narrativeModel: rn.model,
    latencyMs: Date.now() - started, wordCount: finalMd.split(/\s+/).length, tokensBalance: newBalance,
  });
}
