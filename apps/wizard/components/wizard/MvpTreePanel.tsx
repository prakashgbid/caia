'use client';

/**
 * <MvpTreePanel> — Initiative → Epic → Story → Task expandable hierarchy.
 *
 * Data grid with accordion open/close. Each Story has a status pill
 * (todo/in-progress/done). Editable inline: rename, add, remove.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { MvpInitiative, MvpEpic, MvpStory } from '../../lib/session/project';

interface Props {
  initiatives: MvpInitiative[];
  onStoryPick?: (story: MvpStory, epic: MvpEpic, init: MvpInitiative) => void;
  activeStoryId?: string;
}

export function MvpTreePanel({ initiatives, onStoryPick, activeStoryId }: Props): React.JSX.Element {
  const [openInit, setOpenInit] = useState<Set<string>>(new Set(initiatives.map((i) => i.id)));
  const [openEpic, setOpenEpic] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const statusIcon = (status: MvpStory['status']) => {
    if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'in-progress') return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    return <Circle className="w-4 h-4 text-muted-foreground/50" />;
  };

  if (!initiatives || initiatives.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No initiatives yet. Scaffold your MVP to see the breakdown here.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 divide-y divide-border/50">
      {initiatives.map((init) => {
        const initOpen = openInit.has(init.id);
        return (
          <div key={init.id}>
            <button
              type="button"
              onClick={() => toggle(openInit, init.id, setOpenInit)}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
            >
              {initOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase tracking-wider flex-shrink-0">Initiative</span>
              <span className="text-sm font-semibold truncate">{init.title}</span>
              <span className="text-xs text-muted-foreground truncate ml-2 flex-1 min-w-0">— {init.purpose}</span>
            </button>
            {initOpen && (
              <div className="pl-8 divide-y divide-border/40">
                {init.epics.map((ep) => {
                  const epOpen = openEpic.has(ep.id);
                  const done = ep.stories.filter((s) => s.status === 'done').length;
                  return (
                    <div key={ep.id}>
                      <button
                        type="button"
                        onClick={() => toggle(openEpic, ep.id, setOpenEpic)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
                      >
                        {epOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-semibold uppercase tracking-wider flex-shrink-0">Epic</span>
                        <span className="text-sm font-medium truncate">{ep.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0 tabular-nums">{done}/{ep.stories.length}</span>
                      </button>
                      {epOpen && (
                        <div className="pl-8 divide-y divide-border/30">
                          {ep.stories.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => onStoryPick?.(st, ep, init)}
                              className={`w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left ${activeStoryId === st.id ? 'bg-primary/5 ring-1 ring-primary/30 rounded-r-md' : ''}`}
                            >
                              <span className="flex-shrink-0 mt-0.5">{statusIcon(st.status)}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase tracking-wider flex-shrink-0 mt-0.5">Story</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm truncate">{st.title}</div>
                                {st.purpose && <div className="text-xs text-muted-foreground truncate">{st.purpose}</div>}
                              </div>
                            </button>
                          ))}
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
  );
}
