/**
 * STOL-5003 project-onboarding flow — dashboard gate, project cards, and
 * the two-panel factory explorer (all mock data, no backend).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const routerMock = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/dashboard',
}));

import DashboardPage from '../app/dashboard/page';
import { NewProjectWorkbench } from '../components/new-project-workbench';
import { AuthGatedLink } from '../components/auth-gated-link';
import { setMockAuth } from '../lib/mock-auth';
import {
  allFactoryItems,
  factoryStages,
  findFactoryItem,
  mockProjects,
} from '../lib/mock-data';

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('factory catalog (STOL-1034 mock data)', () => {
  it('contains all 141 SF microfactories and 15 CP components', () => {
    expect(allFactoryItems.filter((i) => i.kind === 'sf')).toHaveLength(141);
    expect(allFactoryItems.filter((i) => i.kind === 'cp')).toHaveLength(15);
  });

  it('groups items into macro stages with unique ids', () => {
    expect(factoryStages.length).toBeGreaterThanOrEqual(9);
    const ids = allFactoryItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item ships mock scope, features, and work items', () => {
    for (const item of allFactoryItems) {
      expect(item.scope.length).toBeGreaterThan(0);
      expect(item.features.length).toBeGreaterThan(0);
      expect(item.workItems.length).toBeGreaterThan(0);
    }
  });
});

describe('AuthGatedLink', () => {
  it('routes signed-out clicks to /sign-in with returnTo', () => {
    render(<AuthGatedLink target="/dashboard">Your Projects</AuthGatedLink>);
    fireEvent.click(screen.getByText('Your Projects'));
    expect(routerMock.push).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fdashboard'
    );
  });

  it('routes signed-in clicks straight to the target', () => {
    setMockAuth(true);
    render(<AuthGatedLink target="/dashboard">Your Projects</AuthGatedLink>);
    fireEvent.click(screen.getByText('Your Projects'));
    expect(routerMock.push).toHaveBeenCalledWith('/dashboard');
  });
});

describe('DashboardPage', () => {
  it('renders publicly for signed-out visitors (CAIA-403 — public demo)', async () => {
    render(<DashboardPage />);
    // Was: expected redirect to /sign-in. Now: /dashboard is a public mock,
    // sign-in only required for mutating actions. Redirect must NOT fire.
    expect(
      await screen.findByTestId('dashboard-new-project')
    ).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('shows the New Project CTA and 3-5 sample project cards when signed in', async () => {
    setMockAuth(true);
    render(<DashboardPage />);
    expect(
      await screen.findByTestId('dashboard-new-project')
    ).toBeInTheDocument();
    const cards = await screen.findAllByTestId('project-card');
    expect(cards.length).toBe(mockProjects.length);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(
      screen.getByText('Continue an existing project')
    ).toBeInTheDocument();
  });
});

describe('NewProjectWorkbench', () => {
  it('renders the default selection (SF-00 Vision Intake)', () => {
    render(<NewProjectWorkbench />);
    expect(screen.getByTestId('phase-detail-title')).toHaveTextContent(
      'Vision Intake'
    );
  });

  it('updates the right panel when left-panel items are clicked', () => {
    render(<NewProjectWorkbench />);
    for (const id of ['SF-08', 'SF-91', 'CP-01']) {
      fireEvent.click(screen.getAllByTestId(`phase-item-${id}`)[0]);
      expect(screen.getByTestId('phase-detail-title')).toHaveTextContent(
        findFactoryItem(id)!.item.name
      );
    }
  });

  it('lists every catalog item in the left panel', () => {
    render(<NewProjectWorkbench />);
    for (const id of ['SF-00', 'SF-140', 'CP-15']) {
      expect(screen.getAllByTestId(`phase-item-${id}`).length).toBeGreaterThan(0);
    }
  });
});
