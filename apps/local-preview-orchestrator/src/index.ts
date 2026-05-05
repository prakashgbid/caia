/**
 * Local Preview Orchestrator
 * Always-on local preview deployments for CAIA dashboard + poker-zeno + roulette-community
 */

export { SITES, getSiteConfig, getAllSiteNames, type SiteConfig } from './sites-config.js';
export {
  atomicSwap,
  rollbackToPrevious,
  getCurrentTarget,
  getPreviousTarget
} from './atomic-swap.js';
export { healthCheck, pollHealthCheck, type HealthCheckResult } from './health-check.js';
export { pruneBuilds, isDiskUsageOk, getBuildsSize } from './disk-prune.js';
export {
  logIncident,
  createDeployFailedRecord,
  createHealthCheckFailedRecord,
  createRollbackRecord,
  type IncidentRecord
} from './incident-log.js';

// PR-B additions
export {
  defaultShellRunner,
  runOrThrow,
  type ShellRunner,
  type ShellRunOptions,
  type ShellResult
} from './shell-runner.js';
export { makeGitOps, shellEscape, type GitOps } from './git-ops.js';
export {
  deploySite,
  resolveSitePath,
  resolveBuildDir,
  resolveBuildWorkspace,
  extractShaFromBuildPath,
  LockHeldError,
  type DeployOptions,
  type DeployResult
} from './deploy.js';
export {
  runPollLoop,
  pollIteration,
  defaultSleep,
  type PollLoopOptions,
  type IterationResult
} from './poll-loop.js';
export {
  defaultSiteState,
  readSiteState,
  writeSiteState,
  updateSiteState,
  type SiteState
} from './site-state.js';

// PR-C additions
export {
  createDashboardServer,
  startDashboard,
  buildStatus,
  readLogTail,
  manualRollback,
  handleRequest,
  type StatusDashboardOptions,
  type StatusResponse
} from './status-dashboard.js';
export { DASHBOARD_HTML } from './dashboard-html.js';
