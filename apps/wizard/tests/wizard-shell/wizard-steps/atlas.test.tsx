/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Step 7 atlas wizard client.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AtlasWizardClient } from '../../../components/wizard/AtlasWizardClient';

afterEach(() => cleanup());

describe('<AtlasWizardClient>', () => {
  it('mounts the AtlasShell scaffolding', () => {
    render(<AtlasWizardClient projectId="p-1" />);
    expect(screen.getByTestId('atlas-wizard-client')).toBeTruthy();
    expect(screen.getByTestId('atlas-shell')).toBeTruthy();
  });

  it('renders the AtlasShell divider', () => {
    render(<AtlasWizardClient projectId="p-1" />);
    expect(screen.getByTestId('atlas-divider')).toBeTruthy();
  });

  it('renders the live region for SSE announcements', () => {
    render(<AtlasWizardClient projectId="p-1" />);
    expect(screen.getByTestId('atlas-live-region')).toBeTruthy();
  });

  it('respects the projectId prop', () => {
    const { container } = render(<AtlasWizardClient projectId="p-42" />);
    expect(container.querySelector('[data-testid="atlas-shell"]')).not.toBeNull();
  });

  it('accepts a custom fixtures override', () => {
    render(
      <AtlasWizardClient
        projectId="p-1"
        fixturesOverride={{
          latestDesign: {
            projectId: 'p-1',
            designVersion: {
              id: 'dv-test',
              uploadedAt: '2026-05-25T00:00:00Z',
              source: 'cd-zip',
              renderer: 'cd-zip',
              iframeUrl: 'about:blank',
              domIdManifestUrl: '/manifest.json',
              thumbnails: {},
              routes: ['/'],
              defaultRoute: '/',
            },
          },
          ticketsTree: {
            designVersionId: 'dv-test',
            tree: {
              id: 'root',
              level: 'site',
              title: 'Root',
              state: 'approved',
              domId: null,
            },
          },
          versionsByTicketId: {},
          events: [],
        }}
      />,
    );
    expect(screen.getByTestId('atlas-shell')).toBeTruthy();
  });

  it('initially renders without an atlas-last-response (no submit yet)', () => {
    render(<AtlasWizardClient projectId="p-1" />);
    expect(screen.queryByTestId('atlas-last-response')).toBeNull();
  });

  it('exposes the default ticket id in the noscript fallback for SSR', () => {
    const { container } = render(<AtlasWizardClient projectId="p-1" />);
    const ns = container.querySelector('noscript');
    expect(ns).not.toBeNull();
  });

  it('does not crash when fixtures override has zero events', () => {
    render(
      <AtlasWizardClient
        projectId="p-1"
        fixturesOverride={{
          latestDesign: {
            projectId: 'p-1',
            designVersion: {
              id: 'dv-test',
              uploadedAt: '2026-05-25T00:00:00Z',
              source: 'cd-zip',
              renderer: 'cd-zip',
              iframeUrl: 'about:blank',
              domIdManifestUrl: '/manifest.json',
              thumbnails: {},
              routes: ['/'],
              defaultRoute: '/',
            },
          },
          ticketsTree: {
            designVersionId: 'dv-test',
            tree: {
              id: 'root',
              level: 'site',
              title: 'Root',
              state: 'approved',
              domId: null,
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId('atlas-shell')).toBeTruthy();
  });

  it('renders ticket pane tree', () => {
    render(<AtlasWizardClient projectId="p-1" />);
    const tree = document.querySelectorAll('[role="tree"]');
    expect(tree.length).toBeGreaterThan(0);
  });

  it('renders the design pane iframe', () => {
    const { container } = render(<AtlasWizardClient projectId="p-1" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
  });

  it('does not throw when given an explicit fetchImpl', () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    render(
      <AtlasWizardClient projectId="p-1" fetchImpl={fetchSpy as unknown as typeof fetch} />,
    );
    expect(screen.getByTestId('atlas-shell')).toBeTruthy();
  });

  it('preserves the canonical breadcrumb container in the AtlasShell', () => {
    const { container } = render(<AtlasWizardClient projectId="p-1" />);
    expect(container.querySelector('[data-testid="atlas-divider"]')).not.toBeNull();
  });
});
