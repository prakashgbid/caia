/**
 * Pillar coverage radar (per `chiefaia-com-design-prompt.md` §6).
 *
 * Renders the 16 BusinessPlanV2 pillars (B1..B16) as a polar/radar chart.
 * Each axis is a pillar; the polygon's radius at each axis encodes the
 * `perPillarCoverage` percentage emitted by the interviewer's accumulator.
 *
 * Pure SVG so the widget works without a charting dependency and is
 * trivial to snapshot in tests. The component takes a `coverage` map
 * (PillarId -> 0..100) and a `floor` (default 75 — matches the spec's
 * pillar floor). Pillars below the floor are highlighted in red so the
 * customer sees where the interview still has holes.
 */
import * as React from 'react';

export const PILLAR_IDS = [
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
  'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16',
] as const;
export type PillarId = (typeof PILLAR_IDS)[number];

export interface PillarRadarProps {
  /** PillarId -> 0..100 coverage. Missing pillars default to 0. */
  coverage: Partial<Record<PillarId, number>>;
  /** Pillar floor; pillars below this render in red. Default 75. */
  floor?: number;
  /** Optional override label per pillar (defaults to the pillar id). */
  labels?: Partial<Record<PillarId, string>>;
  /** Optional size override (square). */
  size?: number;
}

export function PillarRadar({
  coverage,
  floor = 75,
  labels = {},
  size = 320,
}: PillarRadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 32;
  const n = PILLAR_IDS.length;

  const point = (i: number, pct: number) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = (Math.max(0, Math.min(100, pct)) / 100) * radius;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };

  const axis = (i: number) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };

  const labelPoint = (i: number) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [
      cx + Math.cos(angle) * (radius + 16),
      cy + Math.sin(angle) * (radius + 16),
    ];
  };

  // Polygon for current coverage values
  const polyPoints = PILLAR_IDS.map((p, i) =>
    point(i, coverage[p] ?? 0).join(','),
  ).join(' ');

  // Background rings (25 / 50 / 75 / 100)
  const rings = [25, 50, 75, 100];

  return (
    <svg
      data-testid="pillar-radar"
      role="img"
      aria-label={`16-pillar coverage radar (floor ${floor}%)`}
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="auto"
      style={{ display: 'block', background: '#0f1117', borderRadius: 8 }}
    >
      {/* Background rings */}
      {rings.map((pct) => (
        <circle
          key={pct}
          cx={cx}
          cy={cy}
          r={(pct / 100) * radius}
          fill="none"
          stroke="#2d3748"
          strokeDasharray={pct === floor ? '4 3' : undefined}
          strokeWidth={1}
          data-testid={pct === floor ? 'pillar-radar-floor' : undefined}
        />
      ))}

      {/* Axes */}
      {PILLAR_IDS.map((p, i) => {
        const [x, y] = axis(i);
        return (
          <line
            key={p}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#1f2937"
            strokeWidth={1}
          />
        );
      })}

      {/* Coverage polygon */}
      <polygon
        data-testid="pillar-radar-polygon"
        points={polyPoints}
        fill="rgba(59, 130, 246, 0.25)"
        stroke="#3b82f6"
        strokeWidth={1.5}
      />

      {/* Per-pillar markers */}
      {PILLAR_IDS.map((p, i) => {
        const pct = coverage[p] ?? 0;
        const [x, y] = point(i, pct);
        const below = pct < floor;
        return (
          <circle
            key={`m-${p}`}
            data-testid={`pillar-marker-${p}`}
            data-coverage={pct}
            data-below-floor={below ? 'true' : 'false'}
            cx={x}
            cy={y}
            r={3.5}
            fill={below ? '#ef4444' : '#3b82f6'}
          />
        );
      })}

      {/* Labels */}
      {PILLAR_IDS.map((p, i) => {
        const [x, y] = labelPoint(i);
        const label = labels[p] ?? p;
        const pct = coverage[p] ?? 0;
        const below = pct < floor;
        return (
          <text
            key={`l-${p}`}
            data-testid={`pillar-label-${p}`}
            x={x}
            y={y}
            fontSize={10}
            fill={below ? '#ef4444' : '#94a3b8'}
            textAnchor="middle"
            dominantBaseline="middle"
            fontWeight={below ? 600 : 400}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
