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
  { slug: 'terms-of-service', title: 'Terms of Service', shortDesc: 'Ready-to-adapt ToS. For founder use only — engage counsel before publishing.', audience: 'Both', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a Terms of Service document tailored to the product (1200-2000 words). Sections: Acceptance, Eligibility, Account, Acceptable Use, User Content, Payment (if any), Cancellation/Refund, Intellectual Property, Disclaimers, Limitation of Liability, Indemnification, Governing Law, Changes, Contact. Plain English, second-person voice. Start with a bold notice: FOR FOUNDER USE ONLY — this is not legal advice. Engage a licensed attorney before you publish these terms.' },
  { slug: 'privacy-policy', title: 'Privacy Policy', shortDesc: 'Ready-to-adapt privacy policy with GDPR/CCPA scaffolding.', audience: 'Both', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a Privacy Policy tailored to the product (1000-1800 words). Sections: What we collect, Why we collect it, How we use it, Sharing with third parties, Cookies & tracking, GDPR rights (access, rectify, erase, portability, object), CCPA rights, Data retention, Data security, International transfers, Children (COPPA), Changes, Contact/DPO. Plain English. Start with a bold notice: FOR FOUNDER USE ONLY — not legal advice. Engage a licensed attorney before publishing.' },
  { slug: 'cookie-banner-snippet', title: 'Cookie Consent Snippet', shortDesc: 'Copy-paste HTML/JS consent banner.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a self-contained HTML + inline JS cookie-consent banner snippet the founder can paste into their site. Requirements: Accept-all, Reject-all, and Customise buttons. Stores choice in localStorage under key `caia_consent`. Fires a window CustomEvent `caia:consent` with the chosen categories (essential, analytics, marketing). Includes basic dark/light auto-styling. Output the snippet inside a single ```html fenced block, then below the block include a short markdown section explaining how to use it and how to check consent from the founder JS.' },
  { slug: 'og-meta-tags', title: 'OpenGraph & Twitter Meta Tags', shortDesc: 'HTML meta tags for social sharing previews.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a set of HTML meta tags for OpenGraph + Twitter Card + basic SEO for the product. Include: og:title, og:description, og:image, og:url, og:type, twitter:card, twitter:title, twitter:description, twitter:image, description, canonical link. Use realistic values derived from the product context. Output the tags inside a single ```html fenced block, then below add a short section on when each tag renders (Slack unfurl, Twitter card preview, iMessage) and what image dimensions to use (1200x630 for og:image).' },
  { slug: 'schema-jsonld', title: 'Schema.org JSON-LD', shortDesc: 'Structured data markup for search engines.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce Schema.org JSON-LD structured data for the product. Include (choose the ones that make sense for the product): Organization, WebSite, WebApplication OR SoftwareApplication OR Product, SearchAction (site-search), BreadcrumbList example. Output each JSON-LD inside its own ```json fenced block, with a short markdown intro before each explaining what it does for SEO/AI answer engines. Values grounded in the product context.' },
  { slug: 'readme', title: 'README.md', shortDesc: 'GitHub README with project overview + quickstart.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a full README.md for the founders GitHub repo (500-1000 words). Sections: Project title + one-liner, Badges (placeholder shields), Overview, Features, Tech Stack, Quickstart (clone/install/run in 3 commands), Development, Testing, Deployment, Contributing, License, Contact. Use plain markdown, real-looking commands (npm/pnpm), and one architecture diagram in a ```mermaid block.' },
  { slug: 'first-30-days-playbook', title: 'First 30 Days — Team Playbook', shortDesc: 'Onboarding plan for the first hire.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 2,
    systemPrompt: 'Produce a First 30 Days playbook for the founders first hire (1000-1500 words). Sections: Week 0 (before day one), Week 1 (context + product tour + first commit), Week 2 (own a small feature), Week 3 (ship independently), Week 4 (retrospective + goal-setting), Ongoing rituals (standup, weekly 1:1, biweekly retro), Success signals (leading indicators), Red flags. Concrete, warm, actionable.' },
  { slug: 'sales-outreach-playbook', title: 'Sales Outreach Playbook', shortDesc: 'Cold email templates + call scripts.', audience: 'You + Team', format: 'markdown', estimatedMinutes: 1,
    systemPrompt: 'Produce a sales-outreach playbook for the product (800-1400 words). Sections: ICP recap (one paragraph), 3 cold-email templates (each with subject line + body + fictional example + when to send), 3 LinkedIn opener templates, discovery-call opening + 5 diagnostic questions + 3 objection handlers, follow-up cadence (7-14-21-30 day touches), a one-page 90-second demo script. Warm, non-spammy, specific to the product.' },
];

export function findDoc(slug: string): DocType | undefined {
  return DOC_CATALOG.find((d) => d.slug === slug);
}
