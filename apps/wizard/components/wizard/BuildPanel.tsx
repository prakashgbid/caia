'use client';

/**
 * <BuildPanel> — Stage 8. Split screen click-through builder.
 *
 * Left column  = controls: idea recap, scaffold, screen picker (pick 5 of 8),
 *                per-screen generate buttons, progress log, next button
 * Right column = Sandpack live preview of the currently-selected screen
 *
 * Uses @codesandbox/sandpack-react (MIT). No custom preview iframe.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sandpack } from '@codesandbox/sandpack-react';
import { ArrowRight, CheckCircle2, Layers, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea, VoiceInput } from '@caia/ui';
import { spendTokens, readSession } from '../../lib/session/tokens';
import { updateProject } from '../../lib/session/project';
import { ViewportSelector, VIEWPORTS, type Viewport } from './common/ViewportSelector';
import { MvpTreePanel } from './MvpTreePanel';
import { StageExplainer } from './common/StageExplainer';
import { DesignPicker } from './DesignPicker';
import { InputExplainer } from './common/InputExplainer';
import { ProcessLoader } from './common/ProcessLoader';
import { AiFailurePanel } from './common/AiFailurePanel';
import { validateFreeText } from '../../lib/validate/text';
import type { MvpInitiative } from '../../lib/session/project';

interface ScreenSpec {
  name: string;
  routePath: string;
  purpose: string;
  estimatedComplexity: 'simple' | 'medium';
  suggested?: boolean;
}

interface Scaffold {
  productName: string;
  initiatives: Array<{ id?: string; title?: string; name?: string; purpose: string; epics?: Array<{ id?: string; title?: string; name?: string; purpose?: string; stories?: Array<{ id?: string; title: string; purpose?: string; status?: 'todo' | 'in-progress' | 'done' }> }> }>;
  epics?: Array<{ name: string; purpose: string; initiativeName: string }>;
  screens: ScreenSpec[];
}

interface GeneratedScreen {
  name: string;
  code: string;
  ts: number;
}

const DEFAULT_APP_CODE = `import { Sparkles } from 'lucide-react';

export default function ScreenComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-6">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">Your MVP will render here</h1>
        <p className="text-slate-600 leading-relaxed">
          Scaffold your MVP on the left, pick 5 screens, and CAIA will build them live in this preview one at a time.
        </p>
      </div>
    </div>
  );
}
`;

export function BuildPanel(props: { initialIdea?: string; initialProposal?: string }): React.JSX.Element {
  const router = useRouter();
  const [ideaText, setIdeaText] = useState(props.initialIdea || '');
  const [proposal, setProposal] = useState(props.initialProposal || '');
  const [scaffold, setScaffold] = useState<Scaffold | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scaffoldBusy, setScaffoldBusy] = useState(false);
  const [scaffoldError, setScaffoldError] = useState<string | null>(null);

  const [generated, setGenerated] = useState<Record<string, GeneratedScreen>>({});
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(['Ready to build.']);
  const [viewport, setViewport] = useState<Viewport>('desktop');

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-40), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const runScaffold = useCallback(async () => {
    const v = validateFreeText(ideaText, { minLen: 15, requireSentence: true });
    if (!v.ok) { setScaffoldError(v.reason || 'Please rewrite your idea.'); return; }
    setScaffoldBusy(true);
    setScaffoldError(null);
    appendLog('Scaffolding MVP…');
    try {
      const res = await fetch('/api/wizard/mvp/scaffold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ideaText, proposal }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string } & Partial<Scaffold>;
      if (!res.ok || !json.ok) {
        setScaffoldError(json.error || `HTTP ${res.status}`);
        appendLog(`Scaffold failed: ${json.error || res.status}`);
        return;
      }
      const s = json as unknown as Scaffold;
      setScaffold(s);
      // Persist to project store — survives interruption.
      updateProject((pp) => {
        pp.productName = s.productName;
        pp.initiatives = (s.initiatives || []).map((it, i) => ({
          id: it.id || `init-${i+1}`,
          title: it.title || it.name || `Initiative ${i+1}`,
          purpose: it.purpose || '',
          epics: (it.epics || []).map((ep, j) => ({
            id: ep.id || `epic-${i+1}-${j+1}`,
            title: ep.title || ep.name || `Epic ${j+1}`,
            purpose: ep.purpose || '',
            stories: (ep.stories || []).map((st, k) => ({
              id: st.id || `story-${i+1}-${j+1}-${k+1}`,
              title: st.title,
              purpose: st.purpose || '',
              status: (st.status as 'todo' | 'in-progress' | 'done') || 'todo',
            })),
          })),
        }));
      });
      const suggested = new Set(s.screens.filter((x) => x.suggested).slice(0, 5).map((x) => x.name));
      setPicked(suggested);
      appendLog(`Scaffolded ${s.screens.length} candidate screens. ${suggested.size} pre-selected.`);
      spendTokens('build');
    } catch (e) {
      const msg = (e as Error).message;
      setScaffoldError(msg);
      appendLog(`Scaffold error: ${msg}`);
    } finally {
      setScaffoldBusy(false);
    }
  }, [ideaText, proposal, appendLog]);

  const togglePick = useCallback((name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < 5) next.add(name);
      return next;
    });
  }, []);

  const generateOne = useCallback(async (spec: ScreenSpec) => {
    if (!scaffold) return;
    setGenBusy(spec.name);
    setGenError(null);
    setActiveScreen(spec.name);
    appendLog(`Generating "${spec.name}"…`);
    try {
      const res = await fetch('/api/wizard/mvp/screen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ideaText,
          productName: scaffold.productName,
          screenName: spec.name,
          screenPurpose: spec.purpose,
          allScreens: scaffold.screens.filter((x) => picked.has(x.name)),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; code?: string; error?: string };
      if (!res.ok || !json.ok || !json.code) {
        setGenError(json.error || `HTTP ${res.status}`);
        appendLog(`Failed "${spec.name}": ${json.error || res.status}`);
        return;
      }
      setGenerated((prev) => ({ ...prev, [spec.name]: { name: spec.name, code: json.code || '', ts: Date.now() } }));
      appendLog(`Rendered "${spec.name}" (${(json.code || '').length} chars).`);
    } catch (e) {
      setGenError((e as Error).message);
      appendLog(`Error "${spec.name}": ${(e as Error).message}`);
    } finally {
      setGenBusy(null);
    }
  }, [ideaText, scaffold, picked, appendLog]);

  const generateAllPicked = useCallback(async () => {
    if (!scaffold) return;
    const list = scaffold.screens.filter((s) => picked.has(s.name));
    for (const s of list) {
      if (generated[s.name]) continue; // skip already generated
      // eslint-disable-next-line no-await-in-loop
      await generateOne(s);
    }
    appendLog('All picked screens generated. Ready for the paywall / download.');
  }, [scaffold, picked, generated, generateOne, appendLog]);

  const activeCode = useMemo(() => {
    if (activeScreen && generated[activeScreen]) return generated[activeScreen].code;
    return DEFAULT_APP_CODE;
  }, [activeScreen, generated]);

  const goNext = useCallback(() => router.push('/wizard/subscribe'), [router]);

  useEffect(() => {
    // If a session came in unauthenticated, kick to /wizard/login (belt-and-suspenders).
    const s = readSession();
    if (!s.loggedIn && s.tokens <= 0) {
      router.replace('/wizard/login?next=/wizard/build');
    }
  }, [router]);

  return (
    <div className="space-y-6">
      <StageExplainer
        title="Build a live click-through of your MVP"
        body="CAIA breaks your product idea into initiatives, epics, and stories, then generates one screen at a time. You'll see them render live in the preview panel."
        why="A click-through prototype is what investors, early users, and your future team need to feel your product before you write a line of production code."
      />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* LEFT: Controls */}
      <div className="space-y-4 min-w-0">
        {/* Design foundation — 3 stories the founder answers before scaffolding.
            Persists to project.design so the code generator can honour it. */}
        <details className="rounded-2xl border border-border/60 bg-card/40 open:bg-card/50 transition-colors">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase tracking-wider">Foundation</span>
              <span className="text-sm font-semibold">Design system, style & theme</span>
            </div>
            <span className="text-xs text-muted-foreground">Set once · used everywhere</span>
          </summary>
          <div className="p-4 border-t border-border/50">
            <DesignPicker />
          </div>
        </details>

        <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
          <CardHeader className="space-y-2">
            <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              <Sparkles className="w-3 h-3" /> Step 8 · Build the MVP
            </div>
            <CardTitle className="text-xl">Live click-through builder</CardTitle>
            <CardDescription>Scaffold, pick five screens, and CAIA renders each in the live preview.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-muted-foreground">Idea</label>
                <VoiceInput value={ideaText} onValueChange={setIdeaText} fieldLabel="idea" />
              </div>
              <Textarea value={ideaText} onChange={(e) => setIdeaText(e.target.value)} rows={3} className="text-sm" placeholder="Describe your product idea in a sentence or two…" />
              <InputExplainer hint="Plain English is best. What is the product, who is it for, why now?" example="A neighborhood recipe-sharing app where neighbors post recipes and can chat." />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-muted-foreground">Proposal</label>
                <VoiceInput value={proposal} onValueChange={setProposal} fieldLabel="proposal" />
              </div>
              <Textarea value={proposal} onChange={(e) => setProposal(e.target.value)} rows={4} className="text-sm" placeholder="Optional. What features should the MVP include?" />
              <InputExplainer hint="Skip if you'd like — CAIA can propose one for you." example="MVP: post a recipe with photo, browse feed, request ingredient from neighbor, in-app chat." />
            </div>
            {scaffoldBusy ? (
              <ProcessLoader
                status="Scaffolding your MVP…"
                substeps={[
                  'Reading your idea…',
                  'Naming your product…',
                  'Sketching initiatives…',
                  'Grouping into epics…',
                  'Writing user stories…',
                  'Proposing screens…',
                ]}
              />
            ) : (
              <Button onClick={runScaffold} disabled={ideaText.trim().length < 10} className="w-full h-11 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
                <Layers className="w-4 h-4 mr-2" />
                {scaffold ? 'Re-scaffold' : 'Scaffold my MVP'}
              </Button>
            )}
            {scaffoldError && (
              <AiFailurePanel onRetry={runScaffold} message={scaffoldError.length < 120 ? scaffoldError : undefined} />
            )}
          </CardContent>
        </Card>

        {scaffold && (
          <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pick 5 screens ({picked.size}/5)</CardTitle>
              <CardDescription className="text-xs">CAIA suggested {scaffold.screens.filter((s) => s.suggested).length}. Adjust if you like.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {scaffold.screens.map((s) => {
                const chosen = picked.has(s.name);
                const gen = generated[s.name];
                const busy = genBusy === s.name;
                return (
                  <div
                    key={s.name}
                    className={`rounded-lg border p-3 transition-all ${chosen ? 'border-primary/60 bg-primary/5' : 'border-border/50 hover:border-border'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => togglePick(s.name)} className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${chosen ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                            {chosen && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          <div className="font-medium text-sm truncate">{s.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">{s.routePath}</div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2 pl-6">{s.purpose}</div>
                      </button>
                      {chosen && (
                        <Button
                          size="sm"
                          variant={gen ? 'outline' : 'default'}
                          onClick={() => generateOne(s)}
                          disabled={busy}
                          className="text-xs h-8 flex-shrink-0"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : gen ? <RefreshCw className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
                          <span className="ml-1">{gen ? 'Redo' : 'Build'}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              <Button onClick={generateAllPicked} disabled={!!genBusy || picked.size === 0} className="w-full h-10 mt-2 bg-brand-gradient hover:opacity-90 text-white text-sm">
                {genBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Build all picked ({picked.size})
              </Button>
              {genError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 text-xs">{genError}</div>
              )}
            </CardContent>
          </Card>
        )}

        {scaffold && scaffold.initiatives && scaffold.initiatives.length > 0 && (
          <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">MVP breakdown</CardTitle>
              <CardDescription className="text-xs">
                Initiative → Epic → Story hierarchy. Click a story to jump its build.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MvpTreePanel
                initiatives={(scaffold.initiatives || []).map((it, i) => ({
                  id: it.id || `init-${i+1}`,
                  title: it.title || it.name || `Initiative ${i+1}`,
                  purpose: it.purpose || '',
                  epics: (it.epics || []).map((ep, j) => ({
                    id: ep.id || `epic-${i+1}-${j+1}`,
                    title: ep.title || ep.name || `Epic ${j+1}`,
                    purpose: ep.purpose || '',
                    stories: (ep.stories || []).map((st, k) => ({
                      id: st.id || `story-${i+1}-${j+1}-${k+1}`,
                      title: st.title,
                      purpose: st.purpose || '',
                      status: (st.status as 'todo' | 'in-progress' | 'done') || 'todo',
                    })),
                  })),
                }))}
              />
            </CardContent>
          </Card>
        )}

        <Card className="border-border/60 bg-card/30 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Build log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[11px] text-muted-foreground">
              {log.map((l, i) => (
                <div key={i} className="truncate">{l}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        {Object.keys(generated).length > 0 && (
          <Button onClick={goNext} className="w-full h-12 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
            Continue to payment / download <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>

      {/* RIGHT: Sandpack live preview */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm min-h-[720px] flex flex-col">
        <CardHeader className="flex-col items-stretch space-y-3 pb-3 border-b border-border/50">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
              </div>
              {activeScreen || 'Live app preview'}
            </CardTitle>
            <ViewportSelector value={viewport} onChange={setViewport} />
          </div>
          {scaffold && Object.keys(generated).length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {Object.keys(generated).map((name) => (
                <button
                  key={name}
                  onClick={() => setActiveScreen(name)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${activeScreen === name ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0">
          <div className="h-full min-h-[640px] rounded-b-lg overflow-hidden flex items-center justify-center bg-muted/20">
            <div
              className="transition-all duration-300 shadow-2xl rounded-lg overflow-hidden bg-white"
              style={{ width: viewport === 'desktop' ? '100%' : `${VIEWPORTS[viewport].w}px`, maxWidth: '100%', height: viewport === 'desktop' ? '640px' : `${Math.min(VIEWPORTS[viewport].h, 720)}px` }}
            >
            <Sandpack
              key={activeScreen || 'default'}
              template="react"
              theme="dark"
              options={{
                showNavigator: false,
                showTabs: false,
                showLineNumbers: false,
                showInlineErrors: true,
                editorHeight: 640,
                editorWidthPercentage: 0,
              }}
              files={{
                '/App.js': { code: activeCode, active: true },
                '/index.js': {
                  code: `import React from 'react';
import { createRoot } from 'react-dom/client';
import './tw-loader.js';
import App from './App';
const root = createRoot(document.getElementById('root'));
root.render(<App />);
`,
                  hidden: true,
                },
                '/tw-loader.js': {
                  code: `// Injects Tailwind CDN + Inter font once when this MVP preview boots.
if (typeof document !== 'undefined' && !document.getElementById('__tw_cdn')) {
  const s = document.createElement('script');
  s.id = '__tw_cdn';
  s.src = 'https://cdn.tailwindcss.com';
  document.head.appendChild(s);
  const f = document.createElement('link');
  f.rel = 'stylesheet';
  f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
  document.head.appendChild(f);
  const st = document.createElement('style');
  st.textContent = "body{font-family:Inter,system-ui,sans-serif;margin:0}";
  document.head.appendChild(st);
}
`,
                  hidden: true,
                },
              }}
              customSetup={{
                dependencies: {
                  'lucide-react': '^0.383.0',
                },
              }}
            />
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
