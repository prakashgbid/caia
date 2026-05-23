/**
 * `<PromptDock>` stories — closed, single, multi, submitting, error,
 * with-history.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { PromptDock } from '../src/index.js';
import {
  HERO_STATS_TICKET_ID,
  versionsByTicketId,
} from '../fixtures/index.js';
import type { AtlasSubmitPromptRequest, AtlasSubmitPromptResponse } from '../src/index.js';

const meta: Meta<typeof PromptDock> = {
  title: 'PromptDock',
  component: PromptDock,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PromptDock>;

const exampleSelection = {
  ticketId: HERO_STATS_TICKET_ID,
  title: 'Stats row',
  level: 'story',
};

function Stage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ position: 'relative', height: '100vh', background: 'var(--atlas-bg, #0b0f17)' }}>
      {children}
    </div>
  );
}

export const Closed: Story = {
  render: () => (
    <Stage>
      <PromptDock selection={null} selectedCount={0} />
    </Stage>
  ),
};

export const Single: Story = {
  render: () => (
    <Stage>
      <PromptDock selection={exampleSelection} selectedCount={1} />
    </Stage>
  ),
};

export const Multi: Story = {
  render: () => (
    <Stage>
      <PromptDock selection={exampleSelection} selectedCount={3} />
    </Stage>
  ),
};

export const Submitting: Story = {
  render: () => (
    <Stage>
      <PromptDock selection={exampleSelection} selectedCount={1} submitting />
    </Stage>
  ),
};

export const ErrorState: Story = {
  render: () => (
    <Stage>
      <PromptDock
        selection={exampleSelection}
        selectedCount={1}
        error="Submission failed: 503 Service Unavailable"
      />
    </Stage>
  ),
};

export const WithHistory3: Story = {
  render: () => (
    <Stage>
      <PromptDock
        selection={exampleSelection}
        selectedCount={1}
        history={versionsByTicketId[HERO_STATS_TICKET_ID]?.versions ?? []}
      />
    </Stage>
  ),
};

export const InteractiveSubmit: Story = {
  render: () => {
    function Inner(): React.ReactElement {
      const [submitting, setSubmitting] = useState(false);
      const [lastResp, setLastResp] = useState<AtlasSubmitPromptResponse | null>(null);
      return (
        <Stage>
          <PromptDock
            selection={exampleSelection}
            selectedCount={1}
            submitting={submitting}
            onSubmit={async (body: AtlasSubmitPromptRequest) => {
              setSubmitting(true);
              await new Promise((r) => setTimeout(r, 250));
              const r: AtlasSubmitPromptResponse = {
                versionId: 'tv_demo',
                ticketState: 'change-requested',
                expectedChangeDescription: `Rephrased: ${body.prompt}`,
                dispatchedTo: ['caia-frontend-architect'],
                enqueuedAt: new Date().toISOString(),
              };
              setLastResp(r);
              setSubmitting(false);
              return r;
            }}
          />
          {lastResp ? (
            <pre
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                color: '#e5e7eb',
                fontSize: 11,
                background: '#11161f',
                padding: 8,
                borderRadius: 6,
              }}
            >
              {JSON.stringify(lastResp, null, 2)}
            </pre>
          ) : null}
        </Stage>
      );
    }
    return <Inner />;
  },
};
