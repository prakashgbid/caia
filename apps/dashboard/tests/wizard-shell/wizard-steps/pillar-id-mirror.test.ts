/**
 * @vitest-environment node
 *
 * Drift guard for the client-safe `PILLAR_IDS_CLIENT` mirror.
 *
 * The `@caia/interviewer` package is the source of truth for the
 * 16-pillar list. The dashboard's client components can't import it
 * because doing so transitively pulls `@opentelemetry/sdk-node` →
 * `@grpc/grpc-js` → Node's `net` module into the browser bundle.
 *
 * To prevent drift, this test runs in the Node environment (safe to
 * import the engine) and asserts the two lists are identical. If the
 * engine ever adds/removes/reorders a pillar, this test fails and the
 * fix is to update `lib/wizard/pillar-ids.client.ts` to match.
 */
import { describe, expect, it } from 'vitest';
import { PILLAR_IDS } from '@caia/interviewer';
import { PILLAR_IDS_CLIENT } from '../../../lib/wizard/pillar-ids.client';

describe('PILLAR_IDS_CLIENT drift guard', () => {
  it('matches @caia/interviewer\'s PILLAR_IDS exactly (same order, same values)', () => {
    expect(Array.from(PILLAR_IDS_CLIENT)).toEqual(Array.from(PILLAR_IDS));
  });

  it('has length 16 (the canonical 16-pillar contract)', () => {
    expect(PILLAR_IDS_CLIENT).toHaveLength(16);
    expect(PILLAR_IDS).toHaveLength(16);
  });
});
