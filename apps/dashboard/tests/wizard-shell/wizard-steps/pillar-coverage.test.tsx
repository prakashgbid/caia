/**
 * @vitest-environment jsdom
 *
 * Unit tests for <PillarCoverage>. Validates that the radar renders one
 * vertex per canonical PillarId (B1..B16), that scores clamp to [0,100],
 * and that the legend reports the same numbers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PillarCoverage } from '../../../components/wizard/PillarCoverage';
import { PILLAR_IDS } from '@caia/interviewer';

afterEach(() => cleanup());

describe('<PillarCoverage>', () => {
  it('renders the radar svg + aggregate badge', () => {
    render(<PillarCoverage coverage={{}} aggregate={0} />);
    expect(screen.getByTestId('pillar-coverage')).toBeTruthy();
    expect(screen.getByTestId('pillar-coverage-svg')).toBeTruthy();
    expect(screen.getByTestId('pillar-aggregate-badge').textContent).toContain('aggregate 0');
  });

  it('renders one label per canonical PillarId', () => {
    render(<PillarCoverage coverage={{}} aggregate={0} />);
    for (const pid of PILLAR_IDS) {
      expect(screen.getByTestId(`pillar-label-${pid}`)).toBeTruthy();
    }
  });

  it('renders all four background rings', () => {
    render(<PillarCoverage coverage={{}} aggregate={0} />);
    for (const ring of [25, 50, 75, 100]) {
      expect(screen.getByTestId(`pillar-ring-${ring}`)).toBeTruthy();
    }
  });

  it('renders the coverage polygon', () => {
    render(
      <PillarCoverage
        coverage={{ B1: { score: 50, hits: 1, lastTouchedTurn: 1 } }}
        aggregate={3}
      />,
    );
    expect(screen.getByTestId('pillar-coverage-polygon')).toBeTruthy();
  });

  it('shows per-pillar legend entries with the score', () => {
    render(
      <PillarCoverage
        coverage={{
          B1: { score: 80, hits: 2, lastTouchedTurn: 2 },
          B2: { score: 40, hits: 1, lastTouchedTurn: 1 },
        }}
        aggregate={8}
      />,
    );
    expect(screen.getByTestId('pillar-legend-B1').textContent).toContain('80');
    expect(screen.getByTestId('pillar-legend-B2').textContent).toContain('40');
    // Untouched pillars render legend with 0.
    expect(screen.getByTestId('pillar-legend-B16').textContent).toContain('0');
  });

  it('clamps scores above 100 to 100', () => {
    render(
      <PillarCoverage
        coverage={{ B1: { score: 9999, hits: 1, lastTouchedTurn: 1 } }}
        aggregate={1}
      />,
    );
    expect(screen.getByTestId('pillar-legend-B1').textContent).toContain('100');
  });

  it('clamps negative scores to 0', () => {
    render(
      <PillarCoverage
        coverage={{ B1: { score: -50, hits: 1, lastTouchedTurn: 1 } }}
        aggregate={0}
      />,
    );
    expect(screen.getByTestId('pillar-legend-B1').textContent).toContain('0');
  });

  it('surfaces the aggregate in the badge', () => {
    render(<PillarCoverage coverage={{}} aggregate={73} />);
    expect(screen.getByTestId('pillar-aggregate-badge').textContent).toContain('aggregate 73');
  });

  it('uses the supplied size', () => {
    render(<PillarCoverage coverage={{}} aggregate={0} size={420} />);
    const svg = screen.getByTestId('pillar-coverage-svg') as unknown as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('420');
    expect(svg.getAttribute('height')).toBe('420');
  });
});
