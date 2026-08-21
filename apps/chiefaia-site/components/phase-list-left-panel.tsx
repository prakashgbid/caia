/**
 * PhaseListLeftPanel — scrollable list of every CAIA microfactory (SF-##)
 * and control-plane component (CP-##), grouped by macro stage per the
 * STOL-1034 master blueprint. Selecting an item drives the detail panel.
 */

'use client';

import { Badge, cn } from '@caia/ui';
import type { FactoryStage } from '../lib/mock-data';

export function PhaseListLeftPanel({
  stages,
  selectedId,
  onSelect,
}: {
  stages: FactoryStage[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="CAIA factory phases" className="space-y-6">
      {stages.map((stage) => (
        <div key={stage.id}>
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {stage.code === 'CP' ? stage.name : `Stage ${stage.code} — ${stage.name}`}
          </p>
          <ul className="mt-2 space-y-1">
            {stage.items.map((item) => {
              const active = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`phase-item-${item.id}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Badge
                      variant={active ? 'secondary' : 'outline'}
                      className="shrink-0 font-mono text-[10px]"
                    >
                      {item.id}
                    </Badge>
                    <span className="truncate">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
