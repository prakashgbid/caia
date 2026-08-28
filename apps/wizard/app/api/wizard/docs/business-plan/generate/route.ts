/**
 * POST /api/wizard/docs/business-plan/generate
 *
 * Investor-grade business plan generator. Multi-step:
 *   1) Research — perplexity/sonar-reasoning-pro w/ WebSearch → JSON research pack with citations
 *   2) Section-by-section fill — claude-opus-5, one call per section, 1500-2500 words each
 *   3) Synthesis — cover + concatenated sections + research appendix
 *
 * Output target: ~20-30k words, cited, section-scoped. Cost: 80 tokens.
 */

import { NextResponse } from 'next/server';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../../lib/backend/session';
import { query } from '../../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface Req { idea?: unknown; productName?: unknown; founderName?: unknown; research?: unknown; }

const SECTIONS = [
  { key: 'executive-summary',     title: 'Executive Summary',                target: 800 },
  { key: 'company-overview',      title: 'Company Overview',                 target: 1200 },
  { key: 'problem-statement',     title: 'Problem Statement',                target: 1500 },
  { key: 'solution',              title: 'Solution & Value Proposition',     target: 2000 },
  { key: 'market-analysis',       title: 'Market Analysis (TAM/SAM/SOM)',    target: 2500 },
  { key: 'competitive-landscape', title: 'Competitive Landscape',            target: 2000 },
  { key: 'business-model',        title: 'Business Model & Pricing',         target: 1800 },
  { key: 'gtm',                   title: 'Go-To-Market Plan',                target: 2200 },
  { key: 'operations',            title: 'Operations Plan',                  target: 1500 },
  { key: 'team',                  title: 'Team & Org Structure',             target: 1200 },
  { key: 'financials',            title: 'Financial Projections (3-year)',   target: 2200 },
  { key: 'risks',                 title: 'Risks & Mitigations',              target: 1200 },
];

export async function POST(req: Request): Promise<NextResponse> {
  const started = Date.now();
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  const founderName = typeof body.founderName === 'string' ? body.founderName : 'The founder';
  if (idea.length < 20) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 80;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  // 1) RESEARCH ----------------------------------------------------------
  let research = body.research as string | undefined;
  if (!research) {
    const researchPrompt = `Research the market and competitive landscape for this product idea. Return the findings as a JSON object with these keys — every claim MUST cite a URL:

{
  "marketSize": { "tamUsd": number, "samUsd": number, "somUsd": number, "sources": string[] },
  "growthRate": { "cagr": number, "horizon": string, "sources": string[] },
  "topCompetitors": [
    { "name": string, "url": string, "positioning": string, "fundingUsd": number | null, "employees": number | null }
  ],
  "customerSegments": [ { "name": string, "sizeUsd": number, "characteristics": string } ],
  "keyTrends": [ { "trend": string, "impact": string, "source": string } ],
  "regulations": [ { "name": string, "jurisdiction": string, "url": string } ],
  "keyRisks": string[]
}

Product idea: "${idea}"

Do NOT fabricate. If a specific number is not verifiable, return null and explain in a sibling _note field. Ground everything in real 2024-2026 data.`;

    const r = await callWithRouting('research.market', {
      userPrompt: researchPrompt,
      responseFormat: 'json',
      maxTokens: 8_000,
      timeoutMs: 180_000,
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, phase: 'research', error: r.error, models: r.modelsAttempted }, { status: 502 });
    }
    research = typeof r.text === 'string' ? r.text : JSON.stringify(r.json);
  }

  // 2) SECTION GEN --------------------------------------------------------
  const sectionResults: Array<{ key: string; title: string; body: string; latencyMs: number; model: string }> = [];
  for (const sec of SECTIONS) {
    const sectionSystem = `You are drafting the "${sec.title}" section of an investor-ready business plan for a real founder. Target length: ${sec.target} words. Rules:

- Cite every quantitative claim with a URL. No un-cited numbers.
- Ground everything in the RESEARCH PACK provided. Do not invent facts.
- Ban filler adjectives ("robust", "scalable", "innovative", "cutting-edge", "revolutionary", "world-class").
- Concrete examples > abstract claims. Specific numbers > vague ranges.
- Section heading: single H2 exactly matching "${sec.title}".
- Format: markdown only, no code fences, no preamble.`;
    const sectionUser = `Product name: ${productName}
Founder: ${founderName}
Product idea: "${idea}"

RESEARCH PACK (JSON):
${research?.slice(0, 20_000)}

Draft the "${sec.title}" section now.`;

    const r = await callWithRouting('doc.business-plan.section', {
      systemPrompt: sectionSystem,
      userPrompt: sectionUser,
      maxTokens: Math.max(3_000, sec.target * 3),
      timeoutMs: 120_000,
    });
    if (!r.ok) {
      sectionResults.push({ key: sec.key, title: sec.title, body: `## ${sec.title}\n\n_(Section generation failed: ${r.error}. Retry later.)_\n`, latencyMs: 0, model: 'error' });
      continue;
    }
    sectionResults.push({ key: sec.key, title: sec.title, body: r.text.trim(), latencyMs: r.latencyMs, model: r.model });
  }

  // 3) SYNTHESIS ---------------------------------------------------------
  const cover = `# ${productName} — Business Plan\n\n**Founder:** ${founderName}  \n**Date:** ${new Date().toLocaleDateString()}  \n\n---\n`;
  const body_md = sectionResults.map((s) => s.body).join('\n\n---\n\n');
  const research_appendix = `\n\n---\n\n## Appendix — Research Pack\n\n\`\`\`json\n${research?.slice(0, 8_000)}\n\`\`\`\n`;
  const finalMd = cover + body_md + research_appendix;

  // 4) LEDGER ------------------------------------------------------------
  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:doc:business-plan')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  const totalLatency = Date.now() - started;
  const wordCount = finalMd.split(/\s+/).length;
  return NextResponse.json({
    ok: true,
    docSlug: 'business-plan',
    title: `${productName} — Business Plan`,
    format: 'markdown',
    content: finalMd,
    sections: sectionResults.map((s) => ({ title: s.title, model: s.model, latencyMs: s.latencyMs })),
    latencyMs: totalLatency,
    wordCount,
    tokensBalance: newBalance,
  });
}
