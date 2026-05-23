/**
 * `<TicketPane>` stories — empty, 50, 600, 5000 (perf canary),
 * filtered, multi-select.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { TicketPane } from '../src/index.js';
import { ticketTree } from '../fixtures/index.js';
import type { AtlasTicketNode, TicketLevel, TicketState } from '../src/index.js';

const meta: Meta<typeof TicketPane> = {
  title: 'TicketPane',
  component: TicketPane,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TicketPane>;

function makeLargeTree(totalChildren: number): AtlasTicketNode {
  const states: TicketState[] = [
    'proposed',
    'approved',
    'change-requested',
    'in-progress',
    'implemented',
    'verified',
    'failed',
    'orphaned',
  ];
  const levels: TicketLevel[] = ['section', 'widget', 'story', 'task'];
  function rec(depth: number, breadth: number, prefix: string): AtlasTicketNode {
    const children: AtlasTicketNode[] = [];
    for (let i = 0; i < breadth; i++) {
      const id = `${prefix}-${i.toString().padStart(3, '0')}`;
      const state = states[i % states.length]!;
      const level = levels[Math.min(levels.length - 1, depth)]!;
      const isLeaf = depth >= 3;
      children.push({
        id,
        level,
        title: `${level} ${id}`,
        state,
        domId: id,
        ...(isLeaf ? {} : { children: [rec(depth + 1, Math.max(1, Math.floor(breadth / 4)), id)] }),
      });
    }
    return {
      id: 'PG-perf',
      level: 'page',
      title: 'Performance canary',
      state: 'approved',
      domId: 'PG-perf',
      children,
    };
  }
  return rec(0, totalChildren, 'perf');
}

function Stateful({ root }: { root: AtlasTicketNode | null }): React.ReactElement {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div style={{ width: 420, height: '100vh' }}>
      <TicketPane
        root={root}
        selectedTicketIds={sel}
        onSelect={(id, mode) =>
          setSel((prev) =>
            mode === 'add'
              ? [...new Set([...prev, id])]
              : mode === 'toggle'
                ? prev.includes(id)
                  ? prev.filter((p) => p !== id)
                  : [...prev, id]
                : [id],
          )
        }
      />
    </div>
  );
}

export const EmptyTree: Story = { render: () => <Stateful root={null} /> };
export const SmallTree: Story = { render: () => <Stateful root={ticketTree.tree} /> };
export const Tree50Nodes: Story = { render: () => <Stateful root={makeLargeTree(50)} /> };
export const Tree600Nodes: Story = { render: () => <Stateful root={makeLargeTree(80)} /> };
export const Tree5000NodesPerfCanary: Story = { render: () => <Stateful root={makeLargeTree(700)} /> };

export const MultiSelected: Story = {
  render: () => {
    const [sel] = useState<string[]>([
      'PG-home',
      'SE-home-hero',
      'WD-home-hero-rotator',
    ]);
    return (
      <div style={{ width: 420, height: '100vh' }}>
        <TicketPane root={ticketTree.tree} selectedTicketIds={sel} />
      </div>
    );
  },
};
