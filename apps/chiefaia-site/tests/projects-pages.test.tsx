/**
 * Smoke tests for the projects surfaces added in
 * [feat/new-project-cta-and-your-projects]:
 *   - /projects ("Your Projects" empty state)
 *   - /projects/new ("New Project" brief-intake placeholder)
 *   - homepage hero "New Project" CTA
 *   - SiteShell header "Your Projects" link
 * Follows the conventions of tests/pages.test.tsx, including the
 * no-fabrication guard.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProjectsPage from '../app/projects/page';
import NewProjectPage from '../app/projects/new/page';
import HomePage from '../app/page';
import { SiteShell } from '../components/site-shell';

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

describe('ProjectsPage (/projects)', () => {
  it('renders the "Your Projects" h1', () => {
    render(<ProjectsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your Projects' })
    ).toBeInTheDocument();
  });

  it('links to the new-project flow and to sign-in', () => {
    render(<ProjectsPage />);
    expect(
      screen.getByRole('link', { name: 'Create your first project' })
    ).toHaveAttribute('href', '/projects/new');
    expect(
      screen.getByRole('link', { name: 'Sign in to continue' })
    ).toHaveAttribute('href', '/sign-in');
  });

  it('contains no fabricated project data or metrics', () => {
    const { container } = render(<ProjectsPage />);
    expectNoFabrication(container.innerHTML);
  });
});

describe('NewProjectPage (/projects/new)', () => {
  it('renders the "New Project" h1', () => {
    render(<NewProjectPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'New Project' })
    ).toBeInTheDocument();
  });

  it('routes to sign-in as the primary action', () => {
    render(<NewProjectPage />);
    expect(
      screen.getByRole('link', { name: 'Sign in to continue' })
    ).toHaveAttribute('href', '/sign-in');
  });

  it('contains no fabricated metrics / testimonials', () => {
    const { container } = render(<NewProjectPage />);
    expectNoFabrication(container.innerHTML);
  });
});

describe('HomePage hero CTA', () => {
  it('renders a "New Project" CTA linking to /projects/new', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('link', { name: 'New Project' })
    ).toHaveAttribute('href', '/projects/new');
  });
});

describe('SiteShell header', () => {
  it('renders a "Your Projects" link to /projects before Sign in', () => {
    render(
      <SiteShell>
        <p>child</p>
      </SiteShell>
    );
    const yourProjects = screen.getByRole('link', { name: 'Your Projects' });
    expect(yourProjects).toHaveAttribute('href', '/projects');
    const signIn = screen.getAllByRole('link', { name: 'Sign in' })[0];
    expect(
      yourProjects.compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
