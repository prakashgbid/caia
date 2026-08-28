'use client';

/**
 * <DocsFolder> — header icon that opens a dropdown listing all generated
 * startup docs for the active project. Counter badge shows total.
 *
 * Clicking a doc opens the /wizard/docs viewer page for it.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Folder, X } from 'lucide-react';
import { readProject, subscribeProject, type StartupDoc } from '../../lib/session/project';

export function DocsFolder(): React.JSX.Element {
  const [docs, setDocs] = useState<StartupDoc[]>([]);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const refresh = () => setDocs(readProject().docs || []);
    refresh();
    return subscribeProject(refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        const dropdown = document.getElementById('caia-docs-dropdown');
        if (dropdown && !dropdown.contains(e.target as Node)) setOpen(false);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
        aria-label={`Your documents (${docs.length})`}
        title="Your generated documents"
      >
        <Folder className="w-4 h-4" />
        {docs.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-brand-gradient text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {docs.length}
          </span>
        )}
      </button>
      {open && (
        <div
          id="caia-docs-dropdown"
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border/60 bg-card shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <div className="text-sm font-semibold">Your documents</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {docs.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No documents yet. CAIA will drop your executive summary, business plan, and pitch deck here as you complete the wizard.
              </div>
            )}
            {docs.map((d) => (
              <Link
                key={d.id}
                href={`/wizard/docs/${d.id}`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-b-0"
              >
                <FileText className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {d.format.toUpperCase()} · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/wizard/docs" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-xs font-semibold text-primary hover:bg-primary/5 border-t border-border/50">
            Show all documents →
          </Link>
        </div>
      )}
    </div>
  );
}
