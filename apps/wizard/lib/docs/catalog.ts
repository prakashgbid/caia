/**
 * Canonical list of startup documents CAIA can generate.
 */

export interface DocType {
  slug: string;
  title: string;
  shortDesc: string;
  audience: string;
  format: 'markdown' | 'pdf' | 'pptx';
  estimatedMinutes: number;
  systemPrompt: string;
}

export const DOC_CATALOG: DocType[] = [
  { slug: 'executive-summary', title: 'Executive Summary', shortDesc: 'One-page overview of the business, opportunity, ask.', audience: 'Investors', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Write a single-page (600-900 words) executive summary in the voice of the founder. Sections: The Problem, The Solution, The Market, Business Model, Traction & Milestones, The Team, The Ask. Plain English, no jargon, warm but confident. Markdown headings only, no tables.' },
  { slug: 'business-plan', title: 'Business Plan (Long)', shortDesc: 'Detailed 15-25 page business plan.', audience: 'Both', format: 'markdown', estimatedMinutes: 3,
    systemPrompt: 'Write a detailed 15-25 page business plan in markdown. Sections: Company Overview, Vision & Mission, Problem Statement, Solution & Value Prop, Target Market (TAM/SAM/SOM), Competitive Landscape, Product/Service Details, Business Model & Pricing, Go-To-Market Plan, Operations Plan, Team & Org Structure, Financial Projections (narrative), Milestones (12 & 24 months), Risks & Mitigations, Appendix. Rich detail; concrete examples; realistic numbers with reasoning.' },
  { slug: 'pitch-deck', title: 'Pitch Deck (10-12 slides)', shortDesc: 'Investor slide deck outline in markdown.', audience: 'Investors', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce an investor pitch-deck outline as markdown with exactly 10-12 slides using H2 for slide titles. Slides: 1 Cover, 2 Problem, 3 Solution, 4 Product Demo, 5 Market Size, 6 Business Model, 7 Traction, 8 Competition, 9 Go-To-Market, 10 Team, 11 Financials & Ask, 12 Vision. Each slide max 5 bullet points. Italic speaker notes under each slide.' },
  { slug: 'one-pager', title: 'One-Pager', shortDesc: 'Single-glance summary for cold outreach.', audience: 'Investors', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a punchy one-pager (250-400 words). Structure: 2-line hook, Problem, Solution, Traction, Team, Ask. Short sentences, high energy, no fluff.' },
  { slug: 'financial-model', title: 'Financial Model (3-yr)', shortDesc: 'P&L, CAC, LTV, runway summary.', audience: 'Investors', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a 3-year financial model narrative in markdown. Sections: Revenue Model, Unit Economics (CAC, LTV, LTV:CAC, Gross Margin), Cost Structure (fixed, variable, headcount), Revenue Projections table (Y1/2/3 by quarter), P&L table, Cash Runway analysis, Key Assumptions. Realistic startup numbers with clear reasoning.' },
  { slug: 'gtm-plan', title: 'Go-To-Market Plan', shortDesc: 'Channels, sales motion, launch.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a GTM plan (1500-2500 words). Sections: ICP, Buyer Persona, Distribution Channels (top 3 with why), Sales Motion, Pricing & Packaging, Launch Sequence, Growth Loops, KPIs. Concrete tactics.' },
  { slug: 'icp-personas', title: 'ICP & Personas', shortDesc: 'Ideal customer + 2-3 personas.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Define ICP (firmographics/demographics) and 2-3 named personas. Each persona: name + role, day in the life, top 3 pains, top 3 goals, discovery channels, objections. Vivid detail.' },
  { slug: 'competitive-analysis', title: 'Competitive Analysis', shortDesc: 'Direct + indirect competitors + moat.', audience: 'Both', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a competitive analysis (1000-1500 words). Sections: Direct competitors (3-5, each with description, strengths, weaknesses), Indirect competitors, Feature comparison, Positioning map, Our moat, Positioning statement.' },
  { slug: 'prd', title: 'Product Requirements Doc', shortDesc: 'What we build, for whom, and why.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a PRD for the MVP. Sections: Overview, Problem, Goals, Non-Goals, Target User, User Stories (As X I want Y so Z), Functional Requirements, Non-Functional Requirements, Success Metrics, Rollout Plan, Open Questions.' },
  { slug: 'roadmap', title: 'Roadmap (Now / Next / Later)', shortDesc: '12-month prioritised roadmap.', audience: 'Both', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a 12-month roadmap: Now (30d), Next (30-90d), Later (90-365d). Each item: title, one-line description, why it matters, rough effort (S/M/L). 3-6 items per bucket. Concrete features.' },
  { slug: 'tech-architecture', title: 'Tech Architecture Overview', shortDesc: 'System diagram + rationale.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a tech architecture overview (800-1500 words). Sections: High-level system, Tech stack recommendation with rationale, Data model, Key APIs & integrations, Security & compliance, Deployment & CI/CD, Scaling strategy. Practical.' },
  { slug: 'brand-guidelines', title: 'Brand Guidelines', shortDesc: 'Voice, tone, palette, typography.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce brand guidelines (600-1000 words). Sections: Voice (3 adjectives + do/dont), Tone by context, Color palette (primary/accent/neutrals with hex + usage), Typography, Logo usage, Imagery style, Sample copy (tagline + 3 lines).' },
  { slug: 'legal-structure', title: 'Legal & IP Overview', shortDesc: 'Entity, contracts, IP strategy.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Legal/IP overview (500-1000 words). Framed as founder learning; not legal advice. Sections: Legal structure (LLC vs C-Corp), Founder agreements, IP strategy (trademarks/patents/trade secrets), ToS & Privacy Policy essentials, Compliance (GDPR/CCPA), Standard contracts needed.' },
  { slug: 'kpi-dashboard', title: 'KPI Dashboard Definition', shortDesc: 'Top 10 metrics to instrument.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Top 10 metrics from day 1. Each: name, why, how to instrument, target range, red-flag range. Group into Growth, Engagement, Revenue, Retention, Product Health.' },
];

export function findDoc(slug: string): DocType | undefined {
  return DOC_CATALOG.find((d) => d.slug === slug);
}
