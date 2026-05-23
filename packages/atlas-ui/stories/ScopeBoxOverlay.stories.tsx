/**
 * `<ScopeBoxOverlay>` stories — no selection, one box, hover preview,
 * multi-select, out-of-viewport.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { ScopeBoxOverlay } from '../src/index.js';

const meta: Meta<typeof ScopeBoxOverlay> = {
  title: 'ScopeBoxOverlay',
  component: ScopeBoxOverlay,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof ScopeBoxOverlay>;

function Stage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        width: 800,
        height: 500,
        background: '#ffffff',
        border: '1px solid #ddd',
      }}
    >
      {children}
    </div>
  );
}

export const Empty: Story = {
  render: () => (
    <Stage>
      <ScopeBoxOverlay boxes={[]} width={800} height={500} />
    </Stage>
  ),
};

export const OneBox: Story = {
  render: () => (
    <Stage>
      <ScopeBoxOverlay
        boxes={[
          {
            domId: 'WD-home-hero-rotator',
            rect: { x: 80, y: 60, w: 600, h: 280 },
            label: 'widget: Rotator',
          },
        ]}
        width={800}
        height={500}
      />
    </Stage>
  ),
};

export const HoverPreview: Story = {
  render: () => (
    <Stage>
      <ScopeBoxOverlay
        boxes={[]}
        hover={{
          domId: 'WD-home-hero-rotator',
          rect: { x: 80, y: 60, w: 600, h: 280 },
          label: 'hover: Rotator',
        }}
        width={800}
        height={500}
      />
    </Stage>
  ),
};

export const MultiSelect: Story = {
  render: () => (
    <Stage>
      <ScopeBoxOverlay
        boxes={[
          { domId: 'A', rect: { x: 20, y: 20, w: 200, h: 80 }, label: 'A' },
          { domId: 'B', rect: { x: 250, y: 100, w: 180, h: 90 }, label: 'B' },
          { domId: 'C', rect: { x: 480, y: 220, w: 230, h: 120 }, label: 'C' },
        ]}
        width={800}
        height={500}
      />
    </Stage>
  ),
};

export const OutOfViewport: Story = {
  render: () => (
    <Stage>
      <ScopeBoxOverlay
        boxes={[
          {
            domId: 'WD-far-below',
            rect: { x: -200, y: 600, w: 300, h: 80 },
            label: 'off-screen',
          },
        ]}
        width={800}
        height={500}
      />
    </Stage>
  ),
};
