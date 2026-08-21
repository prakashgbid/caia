/**
 * Smoke tests for the projects surfaces, updated for the STOL-5003
 * onboarding flow:
 *   - /projects and /projects/new are legacy routes that now run the
 *     mock-auth check and forward to /dashboard(/new-project) or /sign-in
 *   - homepage hero "New Project" CTA is mock-auth gated (target /dashboard)
 *   - SiteShell header "Your Projects" is mock-auth gated (target /dashboard)
 * Follows the conventions of tests/pages.test.tsx, including the
 * no-fabrication guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const routerMock = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/projects',
}));

import ProjectsPage from '../app/projects/page';
import NewProjectPage from '../app/projects/new/page';
import HomePage from '../app/page';
import { SiteShell } from '../components/site-shell';
import { setMockAuth } from '../lib/mock-auth';

const NO_FABRICATION_PATTERNS = [
  /\btestimonial\b/i,
  /"\s*[A-Z][a-z]+\s+(uses|loves|recommends)/,
  /\b\d{1,3}\s*%\s+(faster|fewer|more|reduction)/i,
  /\b\d+\s*[KMB]?\+\s+(users|developers|companies)\b/i,
];

function expectNoFabrication(html: string) {
  for (const re of NO_FABRICATION_PATTERNS) {
    expect(html, `Found forbidden marketing pattern ${re}`).not.toMatch(re);
  }
}

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ProjectsPage (/projects, legacy redirect)', () => {
  it('forwards signed-out visitors to /sign-in with returnTo=/dashboard', async () => {
    render(<ProjectsPage />);
    await vi.waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/sign-in?returnTo=%2Fdashboard'
      )
    );
  });

  it('forwards mock-signed-in visitors to /dashboard', async () => {
    setMockAuth(true);
    render(<ProjectsPage />);
    await vi.waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/dashboard')
    );
  });

  it('contains no fabricated project data or metrics', () => {
    const { container } = render(<ProjectsPage />);
    expectNoFabrication(container.innerHTML);
  });
});

describe('NewProjectPage (/projects/new, legacy redirect)', () => {
  it('forwards signed-out visitors to /sign-in with returnTo', async () => {
    render(<NewProjectPage />);
    await vi.waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/sign-in?returnTo=%2Fdashboard%2Fnew-project'
      )
    );
  });

  it('forwards mock-signed-in visitors to /dashboard/new-project', async () => {
    setMockAuth(true);
    render(<NewProjectPage />);
    await vi.waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/dashboard/new-project')
    );
  });
});

describe('HomePage hero CTA', () => {
  it('renders a mock-auth-gated "New Project" CTA targeting /dashboard', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: 'New Project' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  it('contains no fabricated metrics / testimonials', () => {
    const { container } = render(<HomePage />);
    expectNoFabrication(container.innerHTML);
  });
});

describe('SiteShell header', () => {
  it('renders a mock-auth-gated "Your Projects" link before Sign in', () => {
    render(
      <SiteShell>
        <p>child</p>
      </SiteShell>
    );
    const yourProjects = screen.getByRole('link', { name: 'Your Projects' });
    expect(yourProjects).toHaveAttribute('href', '/dashboard');
    const signIn = screen.getAllByRole('link', { name: 'Sign in' })[0];
    expect(
      yourProjects.compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
