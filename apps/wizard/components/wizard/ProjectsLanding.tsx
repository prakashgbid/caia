'use client';

/**
 * <ProjectsLanding> — the dashboard root.
 *
 * Behavior:
 *   1. On mount, read every ProjectSpec from localStorage + hit
 *      /api/wizard/project/list if the user has a session cookie.
 *   2. If there's ≥1 project, show them as a list (name, last stage,
 *      updated time) — clicking one loads it and routes to
 *      /wizard/<currentStage>.
 *   3. If there are 0 projects, show a big "Start your first project" CTA.
 *   4. Always show "+ New project" button (opens NewProjectModal).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LoginPill } from '../session/LoginPill';
import { useRouter } from 'next/navigation';
import { ArrowRight, Clock, Edit3, FileText, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, Card, CardContent } from '@caia/ui';
import { listSpecs, setActiveSpecId, readSpec, deleteSpec, mutateSpec } from '../../lib/spec/store';
import { NewProjectModal } from '../session/NewProjectModal';
import { StageExplainer } from './common/StageExplainer';

interface RemoteProject { id: string; name: string | null; updatedAt: string; }

const STAGE_PATH: Record<string, string> = {
  onboarding: '/wizard/onboarding', 'grand-idea': '/wizard/grand-idea',
  interview: '/wizard/interview', architecture: '/wizard/architecture',
  proposal: '/wizard/proposal', design: '/wizard/design',
  landing: '/wizard/landing', login: '/wizard/login',
  build: '/wizard/build', subscribe: '/wizard/subscribe',
};

const STAGE_LABEL: Record<string, string> = {
  onboarding: 'Onboarding', 'grand-idea': 'Grand Idea', interview: 'Interview',
  architecture: 'Information Architecture', proposal: 'Proposal', design: 'Design & Theme',
  landing: 'Landing Page', login: 'Log in', build: 'Build the MVP', subscribe: 'Subscribe',
};

interface Combined { id: string; name?: string; updatedAt: number; currentStage?: string; source: 'local' | 'remote' | 'both'; }

export function ProjectsLanding(): React.JSX.Element {
  const router = useRouter();
  const [projects, setProjects] = useState<Combined[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const localList = listSpecs();
    const combined = new Map<string, Combined>();
    for (const l of localList) combined.set(l.id, { ...l, source: 'local' });
    // Try backend
    try {
      const res = await fetch('/api/wizard/project/list', { credentials: 'include' });
      if (res.ok) {
        const j = await res.json() as { ok: boolean; projects: RemoteProject[] };
        if (j.ok) {
          for (const r of j.projects) {
            const ts = new Date(r.updatedAt).getTime();
            const local = combined.get(r.id);
            combined.set(r.id, {
              id: r.id,
              name: r.name || local?.name,
              updatedAt: Math.max(ts, local?.updatedAt || 0),
              currentStage: local?.currentStage,
              source: local ? 'both' : 'remote',
            });
          }
        }
      }
    } catch { /* offline is fine */ }
    setProjects(Array.from(combined.values()).sort((a, b) => b.updatedAt - a.updatedAt));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openProject = useCallback(async (p: Combined) => {
    setActiveSpecId(p.id);
    // If remote, pull latest state_json
    if (p.source !== 'local') {
      try {
        const res = await fetch(`/api/wizard/project/${encodeURIComponent(p.id)}`, { credentials: 'include' });
        if (res.ok) {
          const j = await res.json() as { ok: boolean; project?: { state_json: unknown } };
          if (j.ok && j.project) {
            window.localStorage.setItem('caia.spec.' + p.id, JSON.stringify(j.project.state_json));
          }
        }
      } catch { /* offline — use local */ }
    }
    const spec = readSpec(p.id);
    const stage = spec.currentStage || 'onboarding';
    router.push(STAGE_PATH[stage] || '/wizard/onboarding');
  }, [router]);

  const del = useCallback(async (e: React.MouseEvent, p: Combined) => {
    e.stopPropagation();
    if (!confirm(`Delete "${p.name || 'Untitled'}"? This can't be undone.`)) return;
    deleteSpec(p.id);
    // Attempt remote delete too
    try { await fetch(`/api/wizard/project/${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'include' }); } catch {}
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-brand-gradient flex items-center justify-center glow-brand">
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-foreground text-sm tracking-tight group-hover:text-primary transition-colors">
              CAIA <span className="text-muted-foreground font-normal ml-1">Dashboard</span>
            </span>
          </Link>
          <LoginPill />
        </div>
      </header>
      <main className="max-w-4xl mx-auto space-y-6 py-6 px-4 sm:px-6 lg:px-8">
      <StageExplainer
        title="Your projects"
        body="Every idea you've walked through the wizard is here — pick one to continue exactly where you left off, or start a new project from scratch."
        why="Startups take multiple sessions. We keep your progress per project so no answer, no doc, no code is ever lost between visits."
      />

      {loading && <p className="text-center text-muted-foreground text-sm py-8">Loading your projects…</p>}

      {!loading && projects.length === 0 && (
        <Card className="border-border/60 bg-card/50 text-center">
          <CardContent className="py-12 space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-lg shadow-primary/30">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold">No projects yet</div>
              <p className="text-sm text-muted-foreground mt-1">Start your first project — CAIA turns your idea into an investor-ready click-through MVP.</p>
            </div>
            <Button onClick={() => setNewOpen(true)} className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
              <Plus className="w-4 h-4 mr-2" /> Start your first project
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && projects.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
            <Button onClick={() => setNewOpen(true)} className="bg-brand-gradient hover:opacity-90 text-white text-sm font-semibold">
              <Plus className="w-4 h-4 mr-2" /> New project
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                onClick={() => openProject(p)}
                className="border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card/70 transition-all cursor-pointer group"
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {renamingId === p.id ? (
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const nm = renameDraft.trim() || 'Untitled project';
                              const prevActive = window.localStorage.getItem('caia.activeSpecId');
                              setActiveSpecId(p.id);
                              mutateSpec((sp) => { sp.name = nm; });
                              if (prevActive) setActiveSpecId(prevActive);
                              try { await fetch(`/api/wizard/project/${encodeURIComponent(p.id)}`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nm }) }); } catch {}
                              setRenamingId(null);
                              void refresh();
                            } else if (e.key === 'Escape') {
                              setRenamingId(null);
                            }
                          }}
                          autoFocus
                          className="w-full text-sm font-semibold bg-background border border-primary/60 rounded px-1 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <div className="text-sm font-semibold truncate">{p.name || 'Untitled project'}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Updated {new Date(p.updatedAt).toLocaleDateString()} · {STAGE_LABEL[p.currentStage || 'onboarding']}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameDraft(p.name || ''); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-1"
                      aria-label="Rename project"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { void del(e, p); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${p.source === 'remote' ? 'bg-emerald-500/10 text-emerald-500' : p.source === 'both' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {p.source === 'remote' ? 'Cloud only' : p.source === 'both' ? 'Cloud + local' : 'Local only'}
                    </span>
                    <span className="text-xs text-primary flex items-center gap-1">
                      Continue <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <NewProjectModal open={newOpen} onClose={() => { setNewOpen(false); void refresh(); }} />
      </main>
    </div>
  );
}
