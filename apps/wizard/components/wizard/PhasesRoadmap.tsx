'use client';

/**
 * <PhasesRoadmap> — sidebar-style list of all CAIA Software Factories +
 * Control-Plane components, grouped Done / In progress / To do.
 */

import { useMemo } from 'react';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import { SOFTWARE_FACTORIES, CONTROL_PLANE, groupByStatus, type SFStatus, type Sf } from '../../lib/factory/phases';
import { StageExplainer } from './common/StageExplainer';

function Section({ title, items }: { title: string; items: Sf[] }): React.JSX.Element {
  const grouped = useMemo(() => groupByStatus(items), [items]);
  const order: SFStatus[] = ['in-progress', 'todo', 'done'];
  const icon = (st: SFStatus) => (
    st === 'done'         ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> :
    st === 'in-progress'  ? <Loader2      className="w-3.5 h-3.5 text-primary animate-spin" /> :
                            <Circle       className="w-3.5 h-3.5 text-muted-foreground/40" />
  );
  const label: Record<SFStatus, string> = { 'in-progress': 'In progress', todo: 'To do', done: 'Done' };
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {grouped.done.length} done · {grouped['in-progress'].length} in progress · {grouped.todo.length} to do
        </div>
      </div>
      {order.map((st) => (
        grouped[st].length > 0 && (
          <div key={st} className="border-b border-border/30 last:border-b-0">
            <div className="px-4 py-1.5 bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label[st]} ({grouped[st].length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-y divide-border/20">
              {grouped[st].map((it) => (
                <div key={it.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${st === 'todo' ? 'opacity-70' : ''}`}>
                  <span className="flex-shrink-0">{icon(st)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground w-14 flex-shrink-0">{it.id}</span>
                  <span className="truncate">{it.title}</span>
                </div>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}

export function PhasesRoadmap(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <StageExplainer
        title="The full CAIA factory"
        body="CAIA is a factory of 141 Software Factories (SF) plus 15 Control-Plane services. What you use in the wizard is a small slice — this is the whole map."
        why="Founders often ask 'is CAIA just a wizard?' — no. It's an industrialised software factory. As each factory ships, it moves from 'To do' to 'Done'. You benefit from every one that's live."
      />
      <Section title="Software Factories (SF-00 → SF-140)" items={SOFTWARE_FACTORIES} />
      <Section title="Control-Plane Components (CP-01 → CP-16)" items={CONTROL_PLANE} />
    </div>
  );
}
