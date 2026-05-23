/**
 * `<AgentStatusSidebar>` stories — empty, live, with-error, full-mix.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { AgentStatusSidebar } from '../src/index.js';
import { sampleEvents } from '../fixtures/index.js';

const meta: Meta<typeof AgentStatusSidebar> = {
  title: 'AgentStatusSidebar',
  component: AgentStatusSidebar,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof AgentStatusSidebar>;

function Stage({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ width: 260, height: '100vh' }}>{children}</div>;
}

export const EmptyLive: Story = {
  render: () => (
    <Stage>
      <AgentStatusSidebar events={[]} connected />
    </Stage>
  ),
};

export const Disconnected: Story = {
  render: () => (
    <Stage>
      <AgentStatusSidebar events={[]} connected={false} error={new Error('socket reset')} />
    </Stage>
  ),
};

export const ThreeEvents: Story = {
  render: () => (
    <Stage>
      <AgentStatusSidebar events={sampleEvents} connected />
    </Stage>
  ),
};

export const FullMix: Story = {
  render: () => (
    <Stage>
      <AgentStatusSidebar
        events={[
          ...sampleEvents,
          {
            type: 'agent.run-started',
            ticketId: 'WD-home-hero-rotator',
            agent: 'caia-accessibility-architect',
            runId: 'r_002',
            ts: '2026-05-23T15:00:00Z',
          },
          {
            type: 'agent.run-finished',
            ticketId: 'WD-home-hero-rotator',
            agent: 'caia-accessibility-architect',
            runId: 'r_002',
            result: 'fail',
            ts: '2026-05-23T15:05:00Z',
          },
          {
            type: 'design.version-rebuilt',
            designVersionId: 'dv_prakash_tiwari_v2',
            ts: '2026-05-23T15:10:00Z',
          },
        ]}
        connected
      />
    </Stage>
  ),
};
