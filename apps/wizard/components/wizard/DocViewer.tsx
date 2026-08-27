'use client';

/**
 * <DocViewer> — renders a stored markdown doc for the user, with copy /
 * download / regenerate actions. Handles PDF/PPTX by embedding an iframe.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Download } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@caia/ui';
import { readProject, subscribeProject, type StartupDoc } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';
import { MarkdownRender } from './common/MarkdownRender';

export function DocViewer({ id }: { id: string }): React.JSX.Element {
  const [doc, setDoc] = useState<StartupDoc | null>(null);

  useEffect(() => {
    const refresh = () => {
      const p = readProject();
      setDoc(p.docs.find((d) => d.id === id) || null);
    };
    refresh();
    return subscribeProject(refresh);
  }, [id]);

  if (!doc) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-muted-foreground">Document not found — it may have been cleared.</p>
        <Link href="/wizard/docs" className="text-primary underline mt-4 inline-block">← Back to your documents</Link>
      </div>
    );
  }

  const copy = () => { void navigator.clipboard.writeText(doc.content); };
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy</Button>
          <Button variant="outline" size="sm" onClick={download}><Download className="w-3.5 h-3.5 mr-1.5" /> Download</Button>
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
          <MarkdownRender source={doc.content} />
        </CardContent>
      </Card>
    </div>
  );
}
