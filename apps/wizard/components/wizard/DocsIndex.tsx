'use client';

/** Docs index — lists all generated docs. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { addDoc, readProject, subscribeProject, type StartupDoc } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';
import { ProcessLoader } from './common/ProcessLoader';
import { DOC_CATALOG } from '../../lib/docs/catalog';

export function DocsIndex(): React.JSX.Element {
  const [docs, setDocs] = useState<StartupDoc[]>([]);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setDocs(readProject().docs || []);
    refresh();
    return subscribeProject(refresh);
  }, []);
  const byType = new Map(docs.map((d) => [d.type, d]));

  const generateOne = useCallback(async (slug: string) => {
    setBusySlug(slug);
    try {
      const proj = readProject();
      const res = await fetch('/api/wizard/docs/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          docSlug: slug,
          projectContext: {
            idea: proj.idea || 'A modern SaaS product',
            proposal: proj.proposal || '',
            productName: proj.productName || 'Your product',
            design: proj.design || {},
          },
        }),
      });
      if (!res.ok) return;
      const j = (await res.json()) as { ok?: boolean; content?: string; title?: string; format?: string };
      if (!j.ok || !j.content) return;
      addDoc({
        id: 'doc_' + slug + '_' + Math.random().toString(36).slice(2, 9),
        type: slug,
        title: j.title || slug,
        format: (j.format as StartupDoc['format']) || 'markdown',
        content: j.content,
        createdAt: Date.now(),
        tokens: 0,
      });
    } finally {
      setBusySlug(null);
    }
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <StageExplainer
        title="Your startup documents"
        body="CAIA generates the documents most investors and advisors will ask for. New ones land here as you complete more of the wizard, and you can always regenerate an existing one."
        why="Investors read a founder's docs before they take the meeting. Having a full pack ready — pitch deck, executive summary, financials — removes the biggest early friction."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DOC_CATALOG.map((cat) => {
          const existing = byType.get(cat.slug);
          return (
            <Card key={cat.slug} className={`border-border/60 bg-card/50 backdrop-blur-sm transition-all ${existing ? 'ring-1 ring-primary/30' : 'opacity-90'}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="truncate">{cat.title}</span>
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">{cat.shortDesc}</CardDescription>
                  </div>
                  {existing && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">Ready</span>}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{cat.audience} · {cat.format.toUpperCase()}</span>
                  {existing ? (
                    <Link href={`/wizard/docs/${existing.id}`} className="text-primary font-medium hover:underline">Open →</Link>
                  ) : busySlug === cat.slug ? (
                    <span className="text-primary flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Generating…</span>
                  ) : (
                    <button type="button" onClick={() => generateOne(cat.slug)} className="text-primary font-medium hover:underline flex items-center gap-1">
                      <Wand2 className="w-3 h-3" /> Generate
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1 pt-2">
        <Sparkles className="w-3 h-3" />
        {docs.length} of {DOC_CATALOG.length} generated
      </div>
    </div>
  );
}
