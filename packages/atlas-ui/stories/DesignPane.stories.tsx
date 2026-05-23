/**
 * `<DesignPane>` stories — covers empty, loading, loaded, error.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect, useMemo, useState } from 'react';

import { DesignPane, initialSelection } from '../src/index.js';
import { buildFixtureDataUrl, latestDesign } from '../fixtures/index.js';

const meta: Meta<typeof DesignPane> = {
  title: 'DesignPane',
  component: DesignPane,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof DesignPane>;

function WithFixtureIframe(): React.ReactElement {
  const [url, setUrl] = useState(latestDesign.iframeUrl);
  useEffect(() => setUrl(buildFixtureDataUrl()), []);
  const design = useMemo(() => ({ ...latestDesign, iframeUrl: url }), [url]);
  return (
    <div style={{ height: '100vh' }}>
      <DesignPane design={design} selection={initialSelection} />
    </div>
  );
}

export const Empty: Story = {
  render: () => (
    <div style={{ height: '100vh' }}>
      <DesignPane design={null} selection={initialSelection} />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={{ height: '100vh' }}>
      <DesignPane design={latestDesign} selection={initialSelection} loading />
    </div>
  ),
};

export const LoadedCdZip: Story = {
  render: () => <WithFixtureIframe />,
};

export const Error: Story = {
  render: () => (
    <div style={{ height: '100vh' }}>
      <DesignPane
        design={latestDesign}
        selection={initialSelection}
        error="Manifest collision: SE-home-hero and WD-home-hero-rotator both match the same element"
      />
    </div>
  ),
};
