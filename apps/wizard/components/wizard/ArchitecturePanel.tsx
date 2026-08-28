'use client';

/**
 * <ArchitecturePanel> — real Information Architecture stage.
 *
 * Reads spec.grandIdea + spec.interview.summary, calls /api/wizard/architecture/generate,
 * and renders the returned entities / routes / permissions / user flows / screen map
 * as browsable tabs. Persists to spec.informationArchitecture.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Boxes, Database, GitBranch, Loader2, Route as RouteIcon, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@caia/ui';
import { StageExplainer } from './common/StageExplainer';
import { ProcessLoader } from './common/ProcessLoader';
import { AiFailurePanel } from './common/AiFailurePanel';
import { useSpec, advanceStage } from '../../lib/spec/store';
import { DocsUnlocked } from './common/DocsUnlocked';

interface EntityField { name: string; type: string; required: boolean; description: string; enumValues: string[] | null; relationTo: string | null; }
interface Entity { name: string; description: string; fields: EntityField[]; indexes?: string[]; }
interface Route { path: string; method: string; purpose: string; auth: string; primaryEntity: string; responseShape: string; }
interface Permission { role: string; canDo: string[]; }
interface FlowStep { actor: string; action: string; route: string; outcome: string; }
interface UserFlow { name: string; steps: FlowStep[]; }
interface ScreenMapItem { screen: string; route: string; entitiesShown: string[]; actionsAvailable: string[]; }

interface IAResponse {
  ok: boolean; error?: string;
  entities?: Entity[]; routes?: Route[]; permissions?: Permission[]; userFlows?: UserFlow[]; screenMap?: ScreenMapItem[];
  openQuestions?: string[]; model?: string; latencyMs?: number;
}

type Tab = 'entities' | 'routes' | 'permissions' | 'flows' | 'screens';

export function ArchitecturePanel(): React.JSX.Element {
  const router = useRouter();
  const [spec, mutate] = useSpec();
  const [ia, setIa] = useState<IAResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('entities');

  useEffect(() => { advanceStage('architecture'); }, []);
  useEffect(() => {
    // Rehydrate from spec if we already generated once
    if (spec.informationArchitecture && !ia) {
      const cached = spec.informationArchitecture as unknown as IAResponse;
      if (cached.entities) setIa({ ...cached, ok: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.informationArchitecture]);

  const generate = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/wizard/architecture/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idea: spec.grandIdea, interviewSummary: spec.interview?.summary, productName: spec.productName,
        }),
      });
      const j = (await res.json()) as IAResponse;
      if (!j.ok) throw new Error(j.error || 'IA generation failed.');
      setIa(j);
      mutate((s) => {
        s.informationArchitecture = {
          entities: (j.entities || []).map((e) => ({ name: e.name, description: e.description, fields: e.fields.map((f) => f.name) })),
          routes: (j.routes || []).map((r) => ({ path: r.path, purpose: r.purpose })),
          summary: (j.entities || []).length + ' entities · ' + (j.routes || []).length + ' routes · ' + (j.userFlows || []).length + ' flows',
        };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [spec.grandIdea, spec.interview?.summary, spec.productName, mutate]);

  const goNext = () => router.push('/wizard/proposal');

  const ready = ia && ia.entities && ia.entities.length > 0;
  const canGenerate = spec.grandIdea && spec.grandIdea.trim().length >= 15;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <StageExplainer
        title="Your app's blueprint"
        body="Every screen you'll see later is built from this blueprint. CAIA turns your idea + interview into concrete data entities, URL routes, permissions, user flows, and a screen map — the same artefacts a senior engineer would sketch on day one."
        why="Skipping this step means every downstream call to the code generator is guessing at your data model. Doing it now catches ambiguity while it's cheap to fix, and every screen you build lines up with real database entities and routes."
      />
      <DocsUnlocked stage="architecture" />

      {/* Context lock-in */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground">Context locked in</span>
          <span className="text-[10px] text-muted-foreground">from earlier stages</span>
        </div>
        <div className="text-muted-foreground line-clamp-2">
          <span className="font-medium text-foreground">Finite idea:</span> {spec.grandIdea || <em className="italic">(not set — go to Grand Idea)</em>}
        </div>
        {spec.interview?.summary && (
          <div className="text-muted-foreground line-clamp-3">
            <span className="font-medium text-foreground">Interview:</span> {spec.interview.summary.slice(0, 300)}
          </div>
        )}
      </div>

      {!ready && !busy && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Button onClick={generate} disabled={!canGenerate} className="h-12 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate my Information Architecture
          </Button>
          {!canGenerate && <p className="text-xs text-muted-foreground">Sharpen your Grand Idea first — the IA reads from it.</p>}
        </div>
      )}

      {busy && (
        <ProcessLoader
          status="CAIA is designing your data model + routes…"
          substeps={['Listing entities the idea implies…', 'Sketching fields and relationships…', 'Mapping URL routes to entities…', 'Assigning permissions per role…', 'Tracing user flows across screens…']}
        />
      )}

      {error && <AiFailurePanel onRetry={generate} message={error} />}

      {ready && ia && (
        <>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card p-1 w-fit mx-auto text-xs">
            {(['entities', 'routes', 'permissions', 'flows', 'screens'] as Tab[]).map((t) => {
              const active = tab === t;
              const Icon = { entities: Database, routes: RouteIcon, permissions: ShieldCheck, flows: GitBranch, screens: Boxes }[t];
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all ${active ? 'bg-brand-gradient text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Icon className="w-3.5 h-3.5" /> {t}
                </button>
              );
            })}
          </div>

          {tab === 'entities' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ia.entities!.map((e) => (
                <Card key={e.name} className="border-border/60 bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4 text-primary" />{e.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-xs">
                      {e.fields.map((f) => (
                        <div key={f.name} className="flex items-start gap-2 border-b border-border/30 py-1 last:border-b-0">
                          <span className="font-mono text-foreground">{f.name}</span>
                          <span className="text-[10px] text-primary bg-primary/10 rounded px-1 py-0.5">{f.type}</span>
                          {f.required && <span className="text-[10px] text-amber-500">required</span>}
                          {f.relationTo && <span className="text-[10px] text-muted-foreground">→ {f.relationTo}</span>}
                        </div>
                      ))}
                    </div>
                    {e.indexes && e.indexes.length > 0 && (
                      <div className="mt-2 text-[10px] text-muted-foreground">Indexed: {e.indexes.join(', ')}</div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {tab === 'routes' && (
            <Card className="border-border/60 bg-card/50">
              <CardContent className="p-0 divide-y divide-border/40">
                {ia.routes!.map((r) => (
                  <div key={r.path + r.method} className="grid grid-cols-[80px_1fr_100px] items-center gap-2 px-3 py-2 text-xs">
                    <span className="text-[10px] font-mono uppercase font-bold text-primary">{r.method}</span>
                    <div>
                      <div className="font-mono">{r.path}</div>
                      <div className="text-muted-foreground text-[11px] mt-0.5">{r.purpose}</div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.auth === 'public' ? 'bg-emerald-500/10 text-emerald-500' : r.auth === 'authed' ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'}`}>{r.auth}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {tab === 'permissions' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ia.permissions!.map((p) => (
                <Card key={p.role} className="border-border/60 bg-card/50">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{p.role}</CardTitle></CardHeader>
                  <CardContent className="text-xs space-y-1">
                    {p.canDo.map((c) => <div key={c} className="font-mono text-muted-foreground">✓ {c}</div>)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {tab === 'flows' && (
            <div className="space-y-3">
              {ia.userFlows!.map((f) => (
                <Card key={f.name} className="border-border/60 bg-card/50">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{f.name}</CardTitle></CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    {f.steps.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 border-l-2 border-primary/40 pl-3">
                        <span className="font-semibold text-foreground">{s.actor}</span>
                        <span className="text-muted-foreground">{s.action}</span>
                        <span className="ml-auto font-mono text-[10px] text-primary">{s.route}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {tab === 'screens' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ia.screenMap!.map((sc) => (
                <Card key={sc.screen} className="border-border/60 bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Boxes className="w-4 h-4 text-primary" />{sc.screen}</CardTitle>
                    <p className="font-mono text-[10px] text-muted-foreground">{sc.route}</p>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    <div><span className="font-semibold">Shows:</span> {sc.entitiesShown.join(', ')}</div>
                    <div><span className="font-semibold">Actions:</span> {sc.actionsAvailable.join(', ')}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {ia.openQuestions && ia.openQuestions.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-500">Open questions for the founder</CardTitle></CardHeader>
              <CardContent><ul className="list-disc pl-5 text-xs space-y-1 text-muted-foreground">{ia.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={generate} className="flex-1 h-11 text-sm">
              Regenerate
            </Button>
            <Button onClick={goNext} className="flex-1 h-11 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
              Continue to Proposal <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
