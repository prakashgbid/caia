'use client';

/**
 * <DocViewer> — renders a stored markdown doc for the user, with copy /
 * download / regenerate actions. Handles PDF/PPTX by embedding an iframe.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Download, Printer, Presentation, Pencil, Save, Eye, RotateCcw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@caia/ui';
import { readProject, subscribeProject, updateProject, type StartupDoc } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';
import { MarkdownRender } from './common/MarkdownRender';

export function DocViewer({ id }: { id: string }): React.JSX.Element {
  const [doc, setDoc] = useState<StartupDoc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Array<{ ts: number; content: string }>>([]);

  useEffect(() => {
    const refresh = () => {
      const p = readProject();
      const d = p.docs.find((x) => x.id === id) || null;
      setDoc(d);
      if (d) {
        setDraft((prev) => prev || d.content);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rev = ((d as any).revisions as Array<{ ts: number; content: string }>) || [];
        setRevisions(rev);
      }
    };
    refresh();
    return subscribeProject(refresh);
  }, [id]);

  const save = () => {
    if (!doc) return;
    updateProject((p) => {
      const target = p.docs.find((x) => x.id === doc.id);
      if (!target) return;
      // Push the current content as a revision before overwriting.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = target as any;
      const revs = (t.revisions as Array<{ ts: number; content: string }>) || [];
      revs.push({ ts: Date.now(), content: target.content });
      t.revisions = revs.slice(-10); // keep last 10 revisions
      target.content = draft;
    });
    setSavedAt(Date.now());
    setEditMode(false);
  };

  const restore = (rev: { ts: number; content: string }) => {
    setDraft(rev.content);
    setEditMode(true);
  };

  if (!doc) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-muted-foreground">Document not found — it may have been cleared.</p>
        <Link href="/wizard/docs" className="text-primary underline mt-4 inline-block">← Back to your documents</Link>
      </div>
    );
  }

  const copy = () => { void navigator.clipboard.writeText(doc.content); };
  const printAsPdf = () => {
    if (typeof window === 'undefined') return;
    const w = window.open('', '_blank');
    if (!w) return;
    // Convert current doc's markdown to a print-optimised HTML with Tailwind CDN.
    // The doc content is markdown; we send it as-is and load a markdown renderer client-side.
    w.document.write(`<!DOCTYPE html>
<html><head>
  <meta charset=\"UTF-8\" />
  <title>${doc.title}</title>
  <script src=\"https://cdn.tailwindcss.com\"></script>
  <link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\" />
  <script src=\"https://cdn.jsdelivr.net/npm/marked/marked.min.js\"></script>
  <style>body{font-family:Inter,system-ui,sans-serif;padding:2.5rem;max-width:820px;margin:0 auto;line-height:1.6;color:#0f172a;}h1{font-size:2.2rem;font-weight:800;margin:1.5em 0 .6em;}h2{font-size:1.5rem;font-weight:700;margin:1.2em 0 .5em;}h3{font-size:1.15rem;font-weight:600;margin:1em 0 .4em;}p{margin:.8em 0;}ul,ol{margin:.8em 0 .8em 1.5rem;}li{margin:.3em 0;}code{background:#f1f5f9;padding:.1em .3em;border-radius:.2em;font-size:.9em;}pre{background:#f8fafc;padding:1em;border-radius:.5em;overflow-x:auto;}blockquote{border-left:3px solid #6366f1;padding-left:.9em;color:#475569;margin:1em 0;}@media print{body{padding:1.5rem;max-width:none;}}</style>
</head><body>
  <h1>${doc.title.replace(/</g,'&lt;')}</h1>
  <div id=\"content\"></div>
  <script>
    document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(doc.content)});
    setTimeout(function(){ window.print(); }, 700);
  </script>
</body></html>`);
    w.document.close();
  };

  const exportPptx = async () => {
    if (typeof window === 'undefined') return;
    try {
      // Load pptxgenjs from CDN at click time so we don't ship it in the main bundle.
      const w = window as unknown as { PptxGenJS?: unknown };
      if (!w.PptxGenJS) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.min.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('pptx script failed to load'));
          document.head.appendChild(s);
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PptxGen = (window as any).PptxGenJS as new () => any;
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE';
      // Parse the doc markdown into slides by H2 boundaries.
      const src = doc.content;
      const chunks: Array<{ title: string; body: string }> = [];
      const lines = src.split('\n');
      let currentTitle = doc.title;
      let currentBody: string[] = [];
      for (const line of lines) {
        const m = /^##\s+(.*)$/.exec(line);
        if (m) {
          if (currentBody.length) chunks.push({ title: currentTitle, body: currentBody.join('\n').trim() });
          currentTitle = m[1];
          currentBody = [];
        } else {
          currentBody.push(line);
        }
      }
      if (currentBody.length) chunks.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      // Cover slide
      chunks.unshift({ title: doc.title, body: 'Generated by CAIA' });
      for (const c of chunks) {
        const slide = pres.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addText(c.title, { x: 0.5, y: 0.3, w: 12, h: 0.9, fontSize: 32, bold: true, color: '4F46E5', fontFace: 'Inter' });
        slide.addText(c.body.slice(0, 3000), { x: 0.5, y: 1.4, w: 12, h: 5.8, fontSize: 14, color: '1E293B', fontFace: 'Inter', valign: 'top' });
      }
      await pres.writeFile({ fileName: doc.title.toLowerCase().replace(/\s+/g, '-') + '.pptx' });
    } catch (e) {
      alert('Could not export PPTX: ' + (e as Error).message);
    }
  };

  const download = () => {
    const ext = doc.format === 'markdown' ? 'md' : doc.format;
    const mime = doc.format === 'markdown' ? 'text/markdown' : doc.format === 'html' ? 'text/html' : 'application/octet-stream';
    const blob = new Blob([doc.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${doc.title.toLowerCase().replace(/\s+/g, '-')}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/wizard/docs" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> All documents
        </Link>
        <div className="flex flex-wrap gap-2 justify-end">
          {!editMode && <Button variant="outline" size="sm" onClick={() => setEditMode(true)}><Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit</Button>}
          {editMode && <><Button variant="outline" size="sm" onClick={() => { setEditMode(false); setDraft(doc.content); }}><Eye className="w-3.5 h-3.5 mr-1.5" /> Cancel</Button><Button size="sm" onClick={save} className="bg-brand-gradient text-white hover:opacity-90"><Save className="w-3.5 h-3.5 mr-1.5" /> Save</Button></>}
          <Button variant="outline" size="sm" onClick={copy}><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy</Button>
          <Button variant="outline" size="sm" onClick={download}><Download className="w-3.5 h-3.5 mr-1.5" /> Markdown</Button>
          <Button variant="outline" size="sm" onClick={printAsPdf}><Printer className="w-3.5 h-3.5 mr-1.5" /> PDF</Button>
          <Button variant="outline" size="sm" onClick={exportPptx}><Presentation className="w-3.5 h-3.5 mr-1.5" /> PowerPoint</Button>
        </div>
      </div>
      <StageExplainer
        title={doc.title}
        body={`This is your ${doc.title.toLowerCase()}. Copy it into your fundraising deck, share it with your co-founder, or hand it to an advisor. Everything below was written specifically for your project.`}
      />
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">{doc.title}</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-invert prose-sm max-w-none">
          {editMode ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full min-h-[500px] p-4 text-sm font-mono rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                spellCheck
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{draft.split(/\s+/).length} words · {draft.length} chars</span>
                <span className="italic">Live preview below</span>
              </div>
              <div className="rounded-lg border border-border/40 p-4 bg-background/30">
                <MarkdownRender source={draft} />
              </div>
            </div>
          ) : (
            <MarkdownRender source={doc.content} />
          )}
          {savedAt && !editMode && (
            <div className="text-xs text-emerald-500 mt-3">Saved · {new Date(savedAt).toLocaleTimeString()}</div>
          )}
          {revisions.length > 0 && !editMode && (
            <details className="mt-4 rounded-lg border border-border/40 bg-muted/20">
              <summary className="cursor-pointer text-xs px-3 py-2 font-semibold text-muted-foreground">Revision history ({revisions.length})</summary>
              <div className="divide-y divide-border/30">
                {revisions.slice().reverse().map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="text-muted-foreground tabular-nums">{new Date(r.ts).toLocaleString()}</span>
                    <span className="text-muted-foreground ml-auto">{r.content.length} chars</span>
                    <Button variant="outline" size="sm" onClick={() => restore(r)}><RotateCcw className="w-3 h-3 mr-1" /> Restore</Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
