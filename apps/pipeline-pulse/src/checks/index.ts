export { apiReachable } from './api-reachable';
export { dbWritable } from './db-writable';
export { dbSize } from './db-size';
export { diskSpace } from './disk-space';
export { memoryPressure } from './memory-pressure';
export { executorEnabled } from './executor-enabled';
export { executorHeartbeatFresh } from './executor-heartbeat-fresh';
export { noStuckRunning } from './no-stuck-running';
export { circuitBreakerOpen } from './circuit-breaker-open';
export { failedTasksRate } from './failed-tasks-rate';
export { queueNotStalled } from './queue-not-stalled';
export { eventBusWritable } from './event-bus-writable';
export { longRunningTasks } from './long-running-tasks';
export { schedulerCoherent } from './scheduler-coherent';
export { blockerCount } from './blocker-count';

import { apiReachable } from './api-reachable';
import { dbWritable } from './db-writable';
import { dbSize } from './db-size';
import { diskSpace } from './disk-space';
import { memoryPressure } from './memory-pressure';
import { executorEnabled } from './executor-enabled';
import { executorHeartbeatFresh } from './executor-heartbeat-fresh';
import { noStuckRunning } from './no-stuck-running';
import { circuitBreakerOpen } from './circuit-breaker-open';
import { failedTasksRate } from './failed-tasks-rate';
import { queueNotStalled } from './queue-not-stalled';
import { eventBusWritable } from './event-bus-writable';
import { longRunningTasks } from './long-running-tasks';
import { schedulerCoherent } from './scheduler-coherent';
import { blockerCount } from './blocker-count';
import type { Check } from '../types';

export const ALL_CHECKS: Check[] = [
  // Stage: infra
  apiReachable,
  dbWritable,
  dbSize,
  diskSpace,
  memoryPressure,
  // Stage: executor
  executorEnabled,
  executorHeartbeatFresh,
  noStuckRunning,
  circuitBreakerOpen,
  failedTasksRate,
  // Stage: pipeline
  queueNotStalled,
  eventBusWritable,
  longRunningTasks,
  schedulerCoherent,
  blockerCount,
];

/** Checks whose failure escalates to CRITICAL outcome */
export const CRITICAL_CHECKS = new Set(['api-reachable', 'db-writable']);
