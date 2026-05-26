/**
 * Page-rendering smoke tests. Each page must:
 *   - render without throwing
 *   - put its heading text in the DOM
 *   - NOT contain any fabricated marketing tokens (testimonial / quote / X% / N+ users)
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../app/page';
import PricingPage from '../app/pricing/page';
import DocsIndexPage from '../app/docs/page';
import BlogIndexPage from '../app/blog/page';
import ChangelogPage from '../app/changelog/page';
import ContactPage from '../app/contact/page';
import NotFound from '../app/not-found';

const NO_FABRICATION_PATTERNS = [
  /\btestimonial\b/i,
  /"\s*[A-Z][a-z]+\s+(uses|loves|recommends)/, // pseudo-quote pattern
  /\b\d{1,3}\s*%\s+(faster|fewer|more|reduction)/i, // fabricated metrics
  /\b\d+\s*[KMB]?\+\s+(users|developers|companies)\b/i, // fabricated counts
];

function expectNoFabrication(html: string) {
  for (const re of NO_FABRICATION_PATTERNS) {
    expect(html, `Found forbidden marketing pattern ${re}`).not.toMatch(re);
  }
}

describe('HomePage', () => {
  it('renders the hero h1', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('contains no fabricated metrics / testimonials', () => {
    const { container } = render(<HomePage />);
    expectNoFabrication(container.innerHTML);
  });
});

describe('PricingPage', () => {
  it('renders a TBD price label for each of the three tiers', () => {
    render(<PricingPage />);
    // Each tier renders a price label with an aria-label that includes "price TBD".
    expect(screen.getByLabelText(/Free price TBD/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Professional price TBD/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Team price TBD/i)).toBeInTheDocument();
  });

  it('renders Free / Professional / Team tier titles', () => {
    render(<PricingPage />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('contains no fabricated dollar figures', () => {
    const { container } = render(<PricingPage />);
    expect(container.innerHTML).not.toMatch(/\$\s?\d/);
  });
});

describe('DocsIndexPage', () => {
  it('renders a card per docs category', () => {
    render(<DocsIndexPage />);
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('The 7-step pipeline')).toBeInTheDocument();
    expect(screen.getByText('Architecture')).toBeInTheDocument();
  });
});

describe('BlogIndexPage', () => {
  it('renders the launch post title', () => {
    render(<BlogIndexPage />);
    expect(screen.getByText('Hello, ChiefAIA')).toBeInTheDocument();
  });

  it('does NOT render a fabricated author byline', () => {
    const { container } = render(<BlogIndexPage />);
    expect(container.innerHTML).not.toMatch(/\bby [A-Z][a-z]+ [A-Z][a-z]+\b/);
  });
});

describe('ChangelogPage', () => {
  it('renders the heading and the empty-state card when no entries are baked', () => {
    render(<ChangelogPage />);
    expect(screen.getByText('What we shipped')).toBeInTheDocument();
  });
});

describe('ContactPage', () => {
  it('renders the form heading', () => {
    render(<ContactPage />);
    expect(screen.getByText(/Tell us what you're working on/i)).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('renders the 404 heading and recovery links', () => {
    render(<NotFound />);
    expect(screen.getByText(/couldn't find that page/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});
