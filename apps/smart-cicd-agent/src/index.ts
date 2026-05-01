/**
 * @caia-app/smart-cicd-agent — public exports for the Smart CI/CD Agent.
 *
 * The agent itself runs as a long-running daemon (see ./daemon.ts).
 * This barrel exposes the types + db handlers so other packages can
 * read observations (e.g. the dashboard) or feed the agent test data.
 */

export * from './types.js';
export {
  insertObservation,
  recordActed,
  listObservations,
} from './db.js';
