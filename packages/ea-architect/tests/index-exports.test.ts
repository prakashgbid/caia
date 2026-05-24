import { describe, expect, it } from 'vitest';

import * as eaArchitect from '../src/index.js';

describe('index exports', () => {
  it('exports the agent class', () => {
    expect(typeof eaArchitect.EaArchitectAgent).toBe('function');
  });

  it('exports submitPlan helper', () => {
    expect(typeof eaArchitect.submitPlan).toBe('function');
  });

  it('exports the repository loader functions', () => {
    expect(typeof eaArchitect.loadRepository).toBe('function');
    expect(typeof eaArchitect.selectRelevantContext).toBe('function');
    expect(typeof eaArchitect.tokenise).toBe('function');
    expect(typeof eaArchitect.extractAdrIds).toBe('function');
  });

  it('exports the critic helpers', () => {
    expect(typeof eaArchitect.buildCriticPrompt).toBe('function');
    expect(typeof eaArchitect.parseCriticOutput).toBe('function');
    expect(typeof eaArchitect.applyHallucinationGuard).toBe('function');
    expect(typeof eaArchitect.createDefaultCritic).toBe('function');
    expect(typeof eaArchitect.EA_ARCHITECT_SYSTEM_PROMPT).toBe('string');
  });

  it('exports the ADR writer helpers', () => {
    expect(typeof eaArchitect.writeNewAdr).toBe('function');
    expect(typeof eaArchitect.renderAdrMarkdown).toBe('function');
    expect(typeof eaArchitect.slugifyTitle).toBe('function');
    expect(typeof eaArchitect.formatAdrId).toBe('function');
    expect(typeof eaArchitect.markSupersededBy).toBe('function');
    expect(typeof eaArchitect.applySupersessions).toBe('function');
    expect(typeof eaArchitect.updateDecisionsIndex).toBe('function');
  });

  it('exports the escalation helpers', () => {
    expect(typeof eaArchitect.appendEscalationToInbox).toBe('function');
    expect(typeof eaArchitect.detectStrategicEscalation).toBe('function');
    expect(eaArchitect.ESCALATION_SECTION_HEADER).toBe('## EA AGENT ESCALATIONS');
  });

  it('exports the state machine helpers', () => {
    expect(typeof eaArchitect.canEaReviewTransition).toBe('function');
    expect(typeof eaArchitect.isEaReviewTerminal).toBe('function');
    expect(typeof eaArchitect.chooseTargetState).toBe('function');
    expect(typeof eaArchitect.eventTypeFor).toBe('function');
    expect(typeof eaArchitect.InProcessEventBus).toBe('function');
    expect(Array.isArray(eaArchitect.EA_REVIEW_TERMINAL_STATES)).toBe(true);
  });

  it('exports the FS adapters', () => {
    expect(typeof eaArchitect.InMemoryFsAdapter).toBe('function');
    expect(eaArchitect.defaultFsAdapter).toBeDefined();
  });

  it('exports the agent contract', () => {
    expect(eaArchitect.EA_ARCHITECT_CONTRACT.agentId).toBe('@caia/ea-architect');
    expect(eaArchitect.EA_ARCHITECT_CONTRACT.emitsEvents.length).toBeGreaterThanOrEqual(6);
  });
});
