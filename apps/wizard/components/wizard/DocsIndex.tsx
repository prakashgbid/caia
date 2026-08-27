'use client';

/** Docs index — lists all generated docs. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { readProject, subscribeProject, type StartupDoc } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';
import { DOC_CATALOG } from '../../lib/docs/catalog';

export function DocsIndex(): React.JSX.Element {
  const [docs, setDocs] = useState<StartupDoc[]>([]);
  useEffect(() => {
    const refresh = () => setDocs(readProject().docs || []);
    refresh();
    return subscribeProject(refresh);
  }, []);
  const byType = new Map(docs.map((d) => [d.type, d]));

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
                  ) : (
                    <span className="text-muted-foreground italic">Not generated yet</span>
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
