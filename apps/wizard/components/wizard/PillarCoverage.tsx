'use client';
/**
 * `<PillarCoverage>` — 16-pillar radar for the Step 3 interview.
 *
 * Renders the per-pillar score (0..100) from the interviewer engine's
 * `pillarCoverage` map as a polar-coordinates radar. Pure SVG so the
 * bundle stays small; no chart library dependency.
 *
 * Reuse-first compliance:
 *   - Wrapped in `@caia/ui` Card + Badge so the visual contract matches
 *     the rest of the wizard.
 *   - Reads `PILLAR_IDS` from `@caia/interviewer` — the engine owns the
 *     canonical list of 16 pillars. Adding/removing a pillar there
 *     auto-updates the radar.
 *   - Does NOT import a chart library, raw shadcn, or Tailwind classes
 *     outside of those that come transitively through `@caia/ui`.
 *
 * The radar always draws 16 vertices in PILLAR_IDS order (B1..B16) so
 * the visual is comparable across customers / interviews. Missing
 * coverage entries (e.g. before any answer) render as score=0 vertices
 * collapsed at the origin.
 */

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@caia/ui';
import { PILLAR_IDS_CLIENT, type PillarIdClient } from '../../lib/wizard/pillar-ids.client';

// Client-safe alias — see lib/wizard/pillar-ids.client.ts for the
// drift-guard rationale (engine import would pull @opentelemetry/sdk-node
// into the browser bundle via @chiefaia/tracing/init.js).
const PILLAR_IDS = PILLAR_IDS_CLIENT;
type PillarId = PillarIdClient;

export interface PillarCoverageEntry {
  readonly score: number;
  readonly hits: number;
  readonly lastTouchedTurn: number;
}

export interface PillarCoverageProps {
  /** Map from PillarId → entry. Missing entries default to score=0. */
  coverage: Readonly<Record<string, PillarCoverageEntry>>;
  /** Aggregate score 0..100 across all pillars. */
  aggregate: number;
  /** SVG side in px. Defaults to 240. */
  size?: number;
}

const SVG_SIZE_DEFAULT = 240;
const RINGS = [25, 50, 75, 100];

function safeScore(entry?: PillarCoverageEntry): number {
  if (!entry) return 0;
  if (!Number.isFinite(entry.score)) return 0;
  return Math.max(0, Math.min(100, entry.score));
}

interface Point {
  x: number;
  y: number;
}

function polar(
  centre: number,
  radius: number,
  angleRadians: number,
): Point {
  // -π/2 origin so vertex-0 is at the top (12 o'clock).
  return {
    x: centre + radius * Math.cos(angleRadians - Math.PI / 2),
    y: centre + radius * Math.sin(angleRadians - Math.PI / 2),
  };
}

export function PillarCoverage(props: PillarCoverageProps): React.JSX.Element {
  const { coverage, aggregate, size = SVG_SIZE_DEFAULT } = props;
  const centre = size / 2;
  const maxRadius = (size / 2) * 0.85;
  const pillars = PILLAR_IDS as ReadonlyArray<PillarId>;
  const stepAngle = (2 * Math.PI) / pillars.length;

  const polygonPoints = pillars
    .map((pid, idx) => {
      const score = safeScore(coverage[pid]);
      const r = (score / 100) * maxRadius;
      const p = polar(centre, r, idx * stepAngle);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(' ');

  const labelRadius = maxRadius * 1.1;

  return (
    <Card data-testid="pillar-coverage">
      <CardHeader>
        <CardTitle>16-pillar coverage</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <Badge data-testid="pillar-aggregate-badge">aggregate {aggregate}</Badge>
        </div>
        <svg
          data-testid="pillar-coverage-svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Coverage radar — aggregate ${aggregate} of 100`}
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* Background rings */}
          {RINGS.map((ring) => {
            const ringPoints = pillars
              .map((_, idx) => {
                const r = (ring / 100) * maxRadius;
                const p = polar(centre, r, idx * stepAngle);
                return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
              })
              .join(' ');
            return (
              <polygon
                key={`ring-${ring}`}
                data-testid={`pillar-ring-${ring}`}
                points={ringPoints}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={ring === 100 ? 1.5 : 0.5}
                strokeDasharray={ring === 100 ? '' : '2 3'}
              />
            );
          })}

          {/* Spokes — one per pillar */}
          {pillars.map((pid, idx) => {
            const p = polar(centre, maxRadius, idx * stepAngle);
            return (
              <line
                key={`spoke-${pid}`}
                x1={centre}
                y1={centre}
                x2={p.x.toFixed(2)}
                y2={p.y.toFixed(2)}
                stroke="#e2e8f0"
                strokeWidth={0.5}
              />
            );
          })}

          {/* Coverage polygon */}
          <polygon
            data-testid="pillar-coverage-polygon"
            points={polygonPoints}
            fill="rgba(30, 41, 59, 0.18)"
            stroke="#1e293b"
            strokeWidth={1.25}
          />

          {/* Pillar labels */}
          {pillars.map((pid, idx) => {
            const p = polar(centre, labelRadius, idx * stepAngle);
            const score = safeScore(coverage[pid]);
            return (
              <text
                key={`label-${pid}`}
                data-testid={`pillar-label-${pid}`}
                x={p.x.toFixed(2)}
                y={p.y.toFixed(2)}
                fontSize={9}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={score > 0 ? '#0f172a' : '#94a3b8'}
              >
                {pid}
              </text>
            );
          })}

          {/* Vertex dots */}
          {pillars.map((pid, idx) => {
            const score = safeScore(coverage[pid]);
            const r = (score / 100) * maxRadius;
            const p = polar(centre, r, idx * stepAngle);
            return (
              <circle
                key={`dot-${pid}`}
                data-testid={`pillar-dot-${pid}`}
                cx={p.x.toFixed(2)}
                cy={p.y.toFixed(2)}
                r={2.2}
                fill={score > 0 ? '#1e293b' : '#cbd5e1'}
              />
            );
          })}
        </svg>

        <div
          data-testid="pillar-coverage-legend"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 4,
            marginTop: 12,
            fontSize: 11,
          }}
        >
          {pillars.map((pid) => {
            const score = safeScore(coverage[pid]);
            return (
              <span
                key={`leg-${pid}`}
                data-testid={`pillar-legend-${pid}`}
                style={{
                  padding: '2px 4px',
                  borderRadius: 4,
                  background: score > 0 ? '#dbeafe' : '#f1f5f9',
                  color: score > 0 ? '#1e3a8a' : '#94a3b8',
                  textAlign: 'center',
                }}
              >
                {pid}: {score}
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
