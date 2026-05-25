import { describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { RouterError } from '../src/types.js';
import type { IntentClassifier, RouterDeps } from '../src/types.js';
import { DESIGN_VERSION, body, setup } from './router-setup.js';

describe('createRouter error wrapping', () => {
  it('wraps classifier errors as classifier-failed', async () => {
    const s = setup();
    s.classifier.throws = new Error('llm boom');
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      expect((e as RouterError).kind).toBe('classifier-failed');
    }
  });
  it('wraps writer errors as description-writer-failed', async () => {
    const s = setup();
    s.writer.throws = new Error('writer boom');
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('description-writer-failed');
    }
  });
  it('wraps version-store errors as persistence-failed', async () => {
    const s = setup();
    s.versionStore.throws = new Error('db boom');
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('persistence-failed');
    }
  });
  it('wraps state-machine errors as invalid-transition', async () => {
    const s = setup();
    s.stateMachine.throws = new Error('illegal transition');
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('invalid-transition');
    }
  });
  it('wraps dispatcher errors as dispatcher-failed', async () => {
    const s = setup();
    s.dispatcher.throws = new Error('dispatch boom');
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('dispatcher-failed');
    }
  });
  it('rejects classifier returning invalid kind', async () => {
    const s = setup();
    const badClassifier: IntentClassifier = () => ({ kind: 'totally-wrong' as 'self-only', reason: 'r' });
    const r = createRouter({ ...s.deps, intentClassifier: badClassifier }, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('classifier-failed');
    }
  });
  it('rejects writer returning a non-string', async () => {
    const s = setup();
    const badWriter = (() => 42 as unknown as string) as RouterDeps['expectedChangeWriter'];
    const r = createRouter({ ...s.deps, expectedChangeWriter: badWriter }, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('description-writer-failed');
    }
  });
  it('rejects dispatcher returning a malformed result', async () => {
    const s = setup();
    const badDispatcher: RouterDeps['dispatcher'] = {
      enqueue: () => ({ dispatchedTo: 'not-an-array', enqueuedAt: 42 } as unknown as { dispatchedTo: ReadonlyArray<string>; enqueuedAt: string }),
    };
    const r = createRouter({ ...s.deps, dispatcher: badDispatcher }, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('dispatcher-failed');
    }
  });
});
