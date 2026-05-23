/**
 * `<SelectionBreadcrumb>` stories — empty, shallow, deep, interactive.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { SelectionBreadcrumb } from '../src/index.js';

const meta: Meta<typeof SelectionBreadcrumb> = {
  title: 'SelectionBreadcrumb',
  component: SelectionBreadcrumb,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof SelectionBreadcrumb>;

export const Empty: Story = {
  render: () => <SelectionBreadcrumb segments={[]} />,
};

export const Shallow: Story = {
  render: () => (
    <SelectionBreadcrumb
      segments={[
        { id: 'S-prakash-tiwari', level: 'site', title: 'prakash-tiwari.com' },
        { id: 'PG-home', level: 'page', title: '[/] Home' },
      ]}
    />
  ),
};

export const Deep: Story = {
  render: () => (
    <SelectionBreadcrumb
      segments={[
        { id: 'S-prakash-tiwari', level: 'site', title: 'prakash-tiwari.com' },
        { id: 'PG-home', level: 'page', title: '[/] Home' },
        { id: 'SE-home-hero', level: 'section', title: 'Hero carousel' },
        { id: 'WD-home-hero-rotator', level: 'widget', title: 'Rotator' },
        { id: 'WD-home-hero-slide-01-caia', level: 'widget', title: 'Slide 01 — CAIA' },
        { id: 'WD-home-hero-slide-01-stats', level: 'story', title: 'Stats row' },
      ]}
    />
  ),
};

export const Interactive: Story = {
  render: () => {
    function Inner(): React.ReactElement {
      const [chosen, setChosen] = useState<string | null>(null);
      return (
        <div>
          <SelectionBreadcrumb
            segments={[
              { id: 'S-prakash-tiwari', level: 'site', title: 'prakash-tiwari.com' },
              { id: 'PG-home', level: 'page', title: '[/] Home' },
              { id: 'SE-home-hero', level: 'section', title: 'Hero carousel' },
            ]}
            onSelect={(id) => setChosen(id)}
          />
          <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
            Last chosen: {chosen ?? '(none)'}
          </div>
        </div>
      );
    }
    return <Inner />;
  },
};
