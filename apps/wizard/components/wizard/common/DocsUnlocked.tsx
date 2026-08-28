'use client';

/**
 * <DocsUnlocked> — banner shown at the top of each wizard stage listing
 * which founder-grade documents are now unlocked and generatable.
 *
 * Founders were previously moving through stages unaware that any of the
 * 28-doc startup catalogue was accessible. This panel reminds them at
 * every stage: "based on what you've done so far, here are 3 documents
 * you can generate now."
 */

import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { readProject } from '../../../lib/session/project';
import { useEffect, useState } from 'react';

const STAGE_UNLOCKS: Record<string, Array<{ slug: string; title: string; why: string }>> = {
  'grand-idea': [
    { slug: 'one-pager', title: 'One-Pager', why: 'Instant elevator-pitch summary for cold outreach.' },
  ],
  'interview': [
    { slug: 'executive-summary', title: 'Executive Summary', why: 'Now that your idea is finite, we can draft the investor-facing one-pager.' },
    { slug: 'icp-personas',      title: 'ICP & Personas',   why: 'Your interview answers identified the target user — turn them into named personas.' },
  ],
  'architecture': [
    { slug: 'prd',                title: 'Product Requirements Doc', why: 'Turn the entities + routes + flows into a formal PRD your engineers can build from.' },
    { slug: 'tech-architecture',  title: 'Tech Architecture Overview', why: 'Human-readable system design grounded in your IA blueprint.' },
  ],
  'proposal': [
    { slug: 'business-plan',        title: 'Business Plan (15-25 pages)', why: 'Multi-step, web-searched, cited investor-grade plan.' },
    { slug: 'market-research',      title: 'Market Research Report',      why: 'Real TAM/SAM/SOM + competitors + trends with cited sources.' },
    { slug: 'competitive-analysis', title: 'Competitive Analysis',        why: 'Real competitors discovered via web search — feature matrix + moat.' },
    { slug: 'financial-model',      title: 'Financial Model (.xlsx)',     why: 'Editable spreadsheet with real formulas + reasoned assumptions.' },
    { slug: 'pitch-deck',           title: 'Pitch Deck (.pptx)',           why: 'Real PowerPoint file, 10-12 slides, brand-coloured, speaker notes.' },
  ],
  'design': [
    { slug: 'brand-guidelines', title: 'Brand Guidelines', why: 'Codify your chosen design system + accent + typography for your team.' },
  ],
  'build': [
    { slug: 'roadmap',          title: 'Roadmap (Now / Next / Later)',  why: 'Turn your picked screens into a 12-month prioritised roadmap.' },
    { slug: 'gtm-plan',         title: 'Go-To-Market Plan',             why: 'Now that the product is scoped, plan how you\'ll reach the first 100 users.' },
    { slug: 'sales-outreach-playbook', title: 'Sales Outreach Playbook', why: 'Cold email + LinkedIn templates tailored to your product.' },
  ],
};

interface Props { stage: string; }

export function DocsUnlocked({ stage }: Props): React.JSX.Element | null {
  const unlocks = STAGE_UNLOCKS[stage] || [];
  const [generated, setGenerated] = useState<Set<string>>(new Set());
  useEffect(() => {
    const p = readProject();
    setGenerated(new Set((p.docs || []).map((d) => d.type)));
  }, []);

  if (unlocks.length === 0) return null;
  const pending = unlocks.filter((u) => !generated.has(u.slug));
  if (pending.length === 0) return null;

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {pending.length} founder-grade {pending.length === 1 ? 'document is' : 'documents are'} unlocked at this stage
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Head to <Link href="/wizard/docs" className="text-primary underline">your Docs</Link> anytime to generate them. Recommended now:
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {pending.slice(0, 4).map((u) => (
              <li key={u.slug} className="flex items-start gap-2">
                <FileText className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                <div>
                  <Link href="/wizard/docs" className="font-medium text-foreground hover:text-primary">{u.title}</Link>
                  <span className="text-muted-foreground"> — {u.why}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
