'use client';

/**
 * <MvpBreakdownGrid> — data grid for the enriched MVP breakdown.
 *
 * Renders Initiative → Epic → Story hierarchy in expandable accordions,
 * with per-story: acceptance criteria (Given/When/Then), effort points,
 * user-value + tech-risk scores, dependencies, task list, priority chip.
 * Also shows summary chips: total effort, recommended first epic,
 * recommended team size.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, GitBranch, ListChecks, Users } from 'lucide-react';

interface Task { title: string; type: 'backend' | 'frontend' | 'design' | 'data' | 'infra' | 'qa'; }
interface Story {
  id: string; title: string; purpose: string;
  acceptanceCriteria: string[]; effortPoints: number;
  userValue: number; techRisk: number;
  dependsOn: string[]; tasks: Task[];
}
interface Epic { id: string; title: string; purpose: string; priority: string; stories: Story[]; }
interface Initiative { id: string; title: string; purpose: string; userValue: number; priority: string; epics: Epic[]; }

export interface EnrichedBreakdown {
  productName: string;
  vision: string;
  principles: string[];
  successMetrics: Array<{ metric: string; target: string; why: string }>;
  nonGoals: string[];
  initiatives: Initiative[];
  totalEffortPoints: number;
  recommendedFirstEpic: string;
  recommendedTeamSize: { eng: number; design: number; pm: number; reasoning: string };
}

const PRIORITY_CLASS: Record<string, string> = {
  'mvp': 'bg-emerald-500/15 text-emerald-500 ring-emerald-500/30',
  'v1.1': 'bg-primary/15 text-primary ring-primary/30',
  'v2': 'bg-amber-500/15 text-amber-500 ring-amber-500/30',
  'nice-to-have': 'bg-muted text-muted-foreground ring-border',
};

const TASK_TYPE_CLASS: Record<string, string> = {
  backend: 'bg-blue-500/10 text-blue-400',
  frontend: 'bg-violet-500/10 text-violet-400',
  design: 'bg-pink-500/10 text-pink-400',
  data: 'bg-emerald-500/10 text-emerald-400',
  infra: 'bg-orange-500/10 text-orange-400',
  qa: 'bg-amber-500/10 text-amber-400',
};

function ChipPriority({ p }: { p: string }): React.JSX.Element {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 font-semibold uppercase tracking-wider ${PRIORITY_CLASS[p] || 'bg-muted text-muted-foreground'}`}>{p}</span>;
}

function ChipEffort({ pts }: { pts: number }): React.JSX.Element {
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{pts}pt</span>;
}

function ScoreBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="w-16 text-right">{label}</span>
      <div className="flex-1 max-w-16 h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="tabular-nums font-mono">{value}/5</span>
    </div>
  );
}

export function MvpBreakdownGrid({ breakdown }: { breakdown: EnrichedBreakdown }): React.JSX.Element {
  const [openInit, setOpenInit] = useState<Set<string>>(new Set(breakdown.initiatives.map((i) => i.id)));
  const [openEpic, setOpenEpic] = useState<Set<string>>(new Set());
  const [openStory, setOpenStory] = useState<Set<string>>(new Set());

  const toggle = (s: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Total effort</div>
          <div className="mt-1 flex items-baseline gap-1"><span className="text-3xl font-bold">{breakdown.totalEffortPoints}</span><span className="text-sm text-muted-foreground">story points</span></div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Start here</div>
          <div className="mt-1 text-sm font-semibold">{breakdown.recommendedFirstEpic}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Users className="w-3 h-3" /> Team</div>
          <div className="mt-1 text-sm font-semibold">
            {breakdown.recommendedTeamSize.eng}× eng · {breakdown.recommendedTeamSize.design}× design · {breakdown.recommendedTeamSize.pm}× PM
          </div>
        </div>
      </div>

      {/* Vision + Non-goals + Principles */}
      <div className="rounded-2xl border border-border/60 bg-card/50 p-4 space-y-3 text-sm">
        <div><span className="font-semibold">Vision:</span> <span className="text-muted-foreground">{breakdown.vision}</span></div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Design principles</div>
          <ul className="list-disc pl-5 space-y-0.5 text-sm">
            {breakdown.principles.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Non-goals (won't do in MVP)</div>
          <ul className="list-disc pl-5 space-y-0.5 text-sm text-muted-foreground">
            {breakdown.nonGoals.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Success metrics</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {breakdown.successMetrics.map((m, i) => (
              <div key={i} className="rounded-lg border border-border/40 bg-muted/20 p-2 text-xs">
                <div className="font-semibold">{m.metric}</div>
                <div className="text-muted-foreground">Target: {m.target}</div>
                <div className="text-muted-foreground mt-0.5">{m.why}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Initiative → Epic → Story tree */}
      <div className="rounded-xl border border-border/60 bg-card/30 divide-y divide-border/50">
        {breakdown.initiatives.map((init) => {
          const initOpen = openInit.has(init.id);
          return (
            <div key={init.id}>
              <button type="button" onClick={() => toggle(openInit, init.id, setOpenInit)}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left">
                {initOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase tracking-wider">Initiative</span>
                <span className="text-sm font-semibold truncate">{init.title}</span>
                <ChipPriority p={init.priority} />
                <span className="text-xs text-muted-foreground truncate ml-1 flex-1 min-w-0">— {init.purpose}</span>
              </button>
              {initOpen && (
                <div className="pl-8 divide-y divide-border/40">
                  {init.epics.map((ep) => {
                    const epOpen = openEpic.has(ep.id);
                    const totalPts = ep.stories.reduce((s, x) => s + x.effortPoints, 0);
                    return (
                      <div key={ep.id}>
                        <button type="button" onClick={() => toggle(openEpic, ep.id, setOpenEpic)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left">
                          {epOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-semibold uppercase tracking-wider">Epic</span>
                          <span className="text-sm font-medium truncate">{ep.title}</span>
                          <ChipPriority p={ep.priority} />
                          <ChipEffort pts={totalPts} />
                          <span className="text-xs text-muted-foreground ml-auto tabular-nums">{ep.stories.length} stories</span>
                        </button>
                        {epOpen && (
                          <div className="pl-6 divide-y divide-border/30">
                            {ep.stories.map((st) => {
                              const stOpen = openStory.has(st.id);
                              return (
                                <div key={st.id}>
                                  <button type="button" onClick={() => toggle(openStory, st.id, setOpenStory)}
                                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left">
                                    {stOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />}
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold uppercase tracking-wider mt-0.5">Story</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm">{st.title}</div>
                                    </div>
                                    <ChipEffort pts={st.effortPoints} />
                                  </button>
                                  {stOpen && (
                                    <div className="px-8 pb-4 pt-1 space-y-3 text-xs">
                                      <div>
                                        <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1"><ListChecks className="w-3 h-3" /> Acceptance criteria</div>
                                        <ul className="list-disc pl-4 space-y-1">
                                          {st.acceptanceCriteria.map((ac, i) => <li key={i}>{ac}</li>)}
                                        </ul>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        <ScoreBar label="User value" value={st.userValue} colorClass="bg-emerald-500" />
                                        <ScoreBar label="Tech risk"  value={st.techRisk}  colorClass="bg-amber-500" />
                                      </div>
                                      {st.dependsOn.length > 0 && (
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                          <GitBranch className="w-3 h-3" />
                                          <span>Depends on:</span>
                                          {st.dependsOn.map((d) => <span key={d} className="font-mono px-1.5 py-0.5 rounded bg-muted text-[10px]">{d}</span>)}
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Tasks</div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                          {st.tasks.map((t, i) => (
                                            <div key={i} className="flex items-center gap-2 rounded border border-border/40 px-2 py-1 bg-muted/10">
                                              <span className={`text-[9px] px-1 py-px rounded font-semibold uppercase tracking-wider ${TASK_TYPE_CLASS[t.type] || 'bg-muted'}`}>{t.type}</span>
                                              <span className="truncate">{t.title}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
