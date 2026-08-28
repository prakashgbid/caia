'use client';

/** Docs index — lists all generated docs. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { addDoc, readProject, subscribeProject, type StartupDoc } from '../../lib/session/project';
import { upsertDoc } from '../../lib/spec/store';
import { StageExplainer } from './common/StageExplainer';
import { ProcessLoader } from './common/ProcessLoader';
import { DOC_CATALOG, findDoc } from '../../lib/docs/catalog';

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
    const cat = findDoc(slug);
    if (!cat) { setBusySlug(null); return; }
    try {
      const proj = readProject();
      // Route to dedicated multi-step endpoints for the heavy docs.
      const binary: Record<string, { url: string; ext: string; type: string }> = {
        'pitch-deck':      { url: '/api/wizard/docs/pitch-deck/pptx',       ext: 'pptx', type: 'pptx' },
        'financial-model': { url: '/api/wizard/docs/financial-model/xlsx',  ext: 'xlsx', type: 'xlsx' },
      };
      const dedicated: Record<string, string> = {
        'business-plan': '/api/wizard/docs/business-plan/generate',
        'market-research': '/api/wizard/docs/market-research/generate',
        'competitive-analysis': '/api/wizard/docs/competitive-analysis/generate',
      };
      const idea = proj.idea || 'A modern SaaS product';
      const productName = proj.productName || 'Your product';
      const founderName = proj.name;
      const design = proj.design || {};

      // Binary generators (pptx / xlsx) return the file directly and skip the markdown DocViewer.
      if (binary[slug]) {
        const b = binary[slug];
        const res = await fetch(b.url, {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idea, productName, founderName, design }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${productName.toLowerCase().replace(/\s+/g, '-')}-${slug}.${b.ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        // Add a placeholder StartupDoc so the folder icon shows something.
        upsertDoc({
          type: slug,
          title: cat.title,
          format: b.type as StartupDoc['format'],
          content: `Binary ${b.ext.toUpperCase()} downloaded to your computer.`,
        });
        return;
      }

      const endpoint = dedicated[slug] || '/api/wizard/docs/generate';
      const dedicatedBody = { idea, productName, founderName };
      const genericBody = { docSlug: slug, projectContext: { idea, proposal: proj.proposal || '', productName, design } };
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dedicated[slug] ? dedicatedBody : genericBody),
      });
      if (!res.ok) return;
      const j = (await res.json()) as { ok?: boolean; content?: string; title?: string; format?: string };
      if (!j.ok || !j.content) return;
      upsertDoc({
        type: slug,
        title: j.title || slug,
        format: (j.format as StartupDoc['format']) || 'markdown',
        content: j.content,
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
        {DOC_CATALOG.filter((c) => c.core).map((cat) => {
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
      <details className="rounded-2xl border border-border/60 bg-card/30">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-semibold">
          <span>More templates <span className="text-muted-foreground font-normal ml-1">({DOC_CATALOG.filter((c) => !c.core).length} additional docs — snippets, playbooks, one-off templates)</span></span>
          <span className="text-xs text-muted-foreground">click to expand</span>
        </summary>
        <div className="px-4 pb-4 pt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {DOC_CATALOG.filter((c) => !c.core).map((cat) => {
            const existing = byType.get(cat.slug);
            return (
              <Card key={cat.slug} className={`border-border/60 bg-card/50 backdrop-blur-sm transition-all ${existing ? 'ring-1 ring-primary/30' : 'opacity-90'}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
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
      </details>
      <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1 pt-2">
        <Sparkles className="w-3 h-3" />
        {docs.length} of {DOC_CATALOG.length} generated ({docs.filter((d) => DOC_CATALOG.find((c) => c.slug === d.type)?.core).length} of {DOC_CATALOG.filter((c) => c.core).length} core)
      </div>
    </div>
  );
}
