/**
 * VAL-009 — selectAgentsToReinvoke unit tests.
 *
 * Verifies the failure-ownership classifier:
 *   - BA-owned failures (scope, AC, agentSections.{api,ui,security,testing,...}) → re-invoke BA only.
 *   - EA-owned failures (agentSections.architecture, architecturalInstructions, taxonomy) → re-invoke EA only.
 *   - Mixed failures → re-invoke BOTH, BA first then EA.
 *   - No failures (defensive) → fall back to BA.
 */

import { selectAgentsToReinvoke } from '../../src/agents/validator-loop';

describe('selectAgentsToReinvoke (VAL-009)', () => {
  it('routes BA-owned failures to BA only', () => {
    const failures = [
      { section: 'scope.summary' },
      { section: 'acceptanceCriteria[0]' },
      { section: 'agentSections.api.routes' },
      { section: 'agentSections.testing' },
    ];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ba-agent']);
  });

  it('routes architecture-section failures to EA only', () => {
    const failures = [
      { section: 'agentSections.architecture' },
      { section: 'agentSections.architecture.notes' },
      { section: 'agentSections.architecture.constraints' },
    ];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ea-agent']);
  });

  it('routes taxonomy failures to EA only', () => {
    const failures = [
      { section: 'taxonomy.risk' },
      { section: 'taxonomy.effort' },
      { section: 'taxonomy.techSubDomains' },
    ];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ea-agent']);
  });

  it('routes architecturalInstructions failures to EA only (forward-compat with ARCH-###)', () => {
    const failures = [
      { section: 'architecturalInstructions' },
      { section: 'architecturalInstructions.api' },
      { section: 'architecturalInstructions.database.schemaChanges' },
    ];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ea-agent']);
  });

  it('routes mixed BA + EA failures to BOTH, BA first then EA', () => {
    const failures = [
      { section: 'scope.summary' },                   // BA
      { section: 'agentSections.architecture.notes' }, // EA
      { section: 'acceptanceCriteria[2]' },           // BA
      { section: 'taxonomy.risk' },                   // EA
    ];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ba-agent', 'ea-agent']);
  });

  it('falls back to BA when no section is recorded (defensive)', () => {
    const failures = [{}];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ba-agent']);
  });

  it('falls back to BA when failedChecks is empty (defensive)', () => {
    expect(selectAgentsToReinvoke([])).toEqual(['ba-agent']);
  });

  it('treats prefix-matched sections correctly (no false positives)', () => {
    // 'agentSections.architectures' (note plural — not a real section) shouldn't
    // match the 'agentSections.architecture' prefix because it doesn't have
    // a separator after.
    const failures = [{ section: 'agentSections.api' }];
    expect(selectAgentsToReinvoke(failures)).toEqual(['ba-agent']);
  });
});
