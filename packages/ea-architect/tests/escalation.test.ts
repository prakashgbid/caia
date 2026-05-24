import { describe, expect, it } from 'vitest';

import {
  appendEscalationToInbox,
  detectStrategicEscalation,
  ESCALATION_SECTION_HEADER,
  renderEscalationEntry
} from '../src/escalation.js';
import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import type { OperatorEscalation } from '../src/types.js';

const INBOX = '/test/agent-memory/INBOX.md';
const SAMPLE_ESC: OperatorEscalation = {
  reason: 'plan proposes pivot to consumer market',
  decisionPoint: 'should we pivot or stay enterprise',
  recommendation: 'stay enterprise',
  category: 'product-pivot'
};

describe('escalation', () => {
  it('renderEscalationEntry: renders the four fields', () => {
    const entry = renderEscalationEntry({
      submissionId: 'sub-42',
      callerAgentId: '@caia/researcher',
      planType: 'spec',
      escalation: SAMPLE_ESC,
      at: new Date('2026-05-23T12:00:00Z')
    });
    expect(entry).toContain('sub-42');
    expect(entry).toContain('@caia/researcher');
    expect(entry).toContain('product-pivot');
    expect(entry).toContain('plan proposes pivot');
    expect(entry).toContain('stay enterprise');
    expect(entry).toContain('[ea-agent-escalation]');
  });

  it('renderEscalationEntry: omits recommendation cleanly when absent', () => {
    const { recommendation: _omit, ...withoutRec } = SAMPLE_ESC;
    void _omit;
    const entry = renderEscalationEntry({
      submissionId: 'sub-42',
      callerAgentId: 'a',
      planType: 'spec',
      escalation: withoutRec,
      at: new Date('2026-05-23T12:00:00Z')
    });
    expect(entry).not.toContain('Recommendation');
  });

  it('appendEscalationToInbox: creates INBOX with section if missing', () => {
    const fs = new InMemoryFsAdapter({});
    appendEscalationToInbox(fs, INBOX, {
      submissionId: 'sub-42',
      callerAgentId: '@caia/researcher',
      planType: 'spec',
      escalation: SAMPLE_ESC,
      at: new Date('2026-05-23T12:00:00Z')
    });
    expect(fs.has(INBOX)).toBe(true);
    const body = fs.readFile(INBOX);
    expect(body).toContain(ESCALATION_SECTION_HEADER);
    expect(body).toContain('sub-42');
  });

  it('appendEscalationToInbox: appends to existing section, preserves the rest', () => {
    const fs = new InMemoryFsAdapter({
      [INBOX]: `# INBOX

## Items

- existing entry

${ESCALATION_SECTION_HEADER}

- existing escalation

## Older
old body
`
    });
    appendEscalationToInbox(fs, INBOX, {
      submissionId: 'sub-99',
      callerAgentId: '@caia/x',
      planType: 'process-change',
      escalation: SAMPLE_ESC,
      at: new Date('2026-05-23T12:00:00Z')
    });
    const body = fs.readFile(INBOX);
    expect(body).toContain('existing entry');
    expect(body).toContain('existing escalation');
    expect(body).toContain('sub-99');
    expect(body).toContain('## Older');
    // sub-99 lands inside the EA AGENT ESCALATIONS section, not after "## Older"
    const escIdx = body.indexOf(ESCALATION_SECTION_HEADER);
    const subIdx = body.indexOf('sub-99');
    const olderIdx = body.indexOf('## Older');
    expect(subIdx).toBeGreaterThan(escIdx);
    expect(subIdx).toBeLessThan(olderIdx);
  });

  it('appendEscalationToInbox: creates section when INBOX exists but section missing', () => {
    const fs = new InMemoryFsAdapter({
      [INBOX]: `# INBOX\n\n## Items\n\n- existing entry\n`
    });
    appendEscalationToInbox(fs, INBOX, {
      submissionId: 'sub-1',
      callerAgentId: 'a',
      planType: 'spec',
      escalation: SAMPLE_ESC,
      at: new Date('2026-05-23T12:00:00Z')
    });
    const body = fs.readFile(INBOX);
    expect(body).toContain(ESCALATION_SECTION_HEADER);
    expect(body).toContain('existing entry');
    expect(body).toContain('sub-1');
  });

  it('detectStrategicEscalation: fires on product-pivot wording', () => {
    const out = detectStrategicEscalation('We propose a product pivot to B2C.');
    expect(out).not.toBeNull();
    expect(out?.category).toBe('product-pivot');
  });

  it('detectStrategicEscalation: fires on billing-model wording', () => {
    const out = detectStrategicEscalation('Change the billing model from credits to flat-fee.');
    expect(out?.category).toBe('billing-model-change');
  });

  it('detectStrategicEscalation: fires on security posture wording', () => {
    const out = detectStrategicEscalation('We update the security posture for tenants.');
    expect(out?.category).toBe('security-posture-change');
  });

  it('detectStrategicEscalation: fires on principle amendment wording', () => {
    const out = detectStrategicEscalation('Amend principle P1 to allow API keys.');
    expect(out?.category).toBe('principle-amendment');
  });

  it('detectStrategicEscalation: returns null on routine technical text', () => {
    const out = detectStrategicEscalation(
      'Add a new endpoint for the dashboard. No principle changes.'
    );
    expect(out).toBeNull();
  });
});
