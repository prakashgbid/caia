import { frozenClockFrom } from '../src/clock.js';
import { counterIdGen } from '../src/id.js';
import {
  makeClassifier,
  makeDispatcher,
  makeStateMachine,
  makeStaticMapper,
  makeVersionStore,
  makeWriter,
  type FakeClassifier,
  type FakeDispatcher,
  type FakeStateMachine,
  type FakeVersionStore,
  type FakeWriter,
} from './test-fixtures.js';
import type { AtlasSubmitPromptRequest, MapperPort, RouterDeps } from '../src/types.js';

export const DESIGN_VERSION = 'dv_test_v1';
export const TS_BODY = '2026-05-24T12:00:00.000Z';
export const TS_CLOCK = '2026-05-24T12:00:00.500Z';
export const TS_DISPATCH = '2026-05-24T12:00:00.999Z';

export function tickets() {
  return [
    { id: 'PG-home', domId: 'PG-home' },
    { id: 'SE-hero', domId: 'SE-hero', parentId: 'PG-home' },
    { id: 'WD-rotator', domId: 'WD-rotator', parentId: 'SE-hero' },
    { id: 'WD-slide-01', domId: 'WD-slide-01', parentId: 'WD-rotator' },
    { id: 'ST-stats', domId: 'ST-stats', parentId: 'WD-slide-01' },
    { id: 'SE-projects', domId: 'SE-projects', parentId: 'PG-home' },
  ];
}

export interface Setup {
  deps: RouterDeps;
  mapper: MapperPort;
  versionStore: FakeVersionStore;
  stateMachine: FakeStateMachine;
  dispatcher: FakeDispatcher;
  classifier: FakeClassifier;
  writer: FakeWriter;
}

export function setup(): Setup {
  const mapper = makeStaticMapper(tickets());
  const versionStore = makeVersionStore();
  const stateMachine = makeStateMachine();
  const dispatcher = makeDispatcher({
    dispatchedTo: ['caia-frontend-architect'],
    enqueuedAt: TS_DISPATCH,
  });
  const classifier = makeClassifier({ kind: 'self-only', reason: 'serif keyword' });
  const writer = makeWriter('Change typography of');
  const deps: RouterDeps = {
    mapper,
    versionStore,
    stateMachine,
    dispatcher,
    intentClassifier: classifier,
    expectedChangeWriter: writer,
    clock: frozenClockFrom(TS_CLOCK),
    idGen: counterIdGen('tv'),
  };
  return { deps, mapper, versionStore, stateMachine, dispatcher, classifier, writer };
}

export function body(o: Partial<AtlasSubmitPromptRequest> = {}): AtlasSubmitPromptRequest {
  return {
    prompt: 'make the stats serif and 1.5× bigger',
    selection: ['ST-stats'],
    ts: TS_BODY,
    ...o,
  };
}
