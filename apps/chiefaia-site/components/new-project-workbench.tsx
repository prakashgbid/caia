/**
 * NewProjectWorkbench — two-panel mock explorer for starting a project.
 *
 * Left: every SF-## microfactory + CP-## control-plane component grouped by
 * macro stage (STOL-1034). Right: mock detail (scope / features / work
 * items) for the selected item. Mobile collapses the list into a
 * disclosure above the detail panel. UI-only per STOL-5003.
 */

'use client';

import { useState } from 'react';
import { Button } from '@caia/ui';
import { factoryStages, findFactoryItem } from '../lib/mock-data';
import { PhaseListLeftPanel } from './phase-list-left-panel';
import { PhaseDetailRightPanel } from './phase-detail-right-panel';

const DEFAULT_ID = 'SF-00';

export function NewProjectWorkbench() {
  const [selectedId, setSelectedId] = useState(DEFAULT_ID);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const selected = findFactoryItem(selectedId) ?? findFactoryItem(DEFAULT_ID)!;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <aside className="hidden w-72 shrink-0 md:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border border-border p-3">
          <PhaseListLeftPanel
            stages={factoryStages}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </aside>

      <div className="md:hidden">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          aria-expanded={mobileListOpen}
          data-testid="mobile-phase-list-toggle"
          onClick={() => setMobileListOpen((open) => !open)}
        >
          <span>
            {selected.item.id} — {selected.item.name}
          </span>
          <span aria-hidden="true">{mobileListOpen ? '▴' : '▾'}</span>
        </Button>
        {mobileListOpen ? (
          <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-border p-3">
            <PhaseListLeftPanel
              stages={factoryStages}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setMobileListOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <PhaseDetailRightPanel item={selected.item} stage={selected.stage} />
      </div>
    </div>
  );
}
