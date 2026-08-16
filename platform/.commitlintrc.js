/**
 * Commit-message linting for CAIA.
 * Enforces Conventional Commits with an SF-scope enum.
 *
 * Examples that pass:
 *   feat(SF-42): implement generate-code microfactory
 *   fix(KERNEL-1): retry on 5xx from event-bus
 *   docs(SF-00): add intent-capture contract examples
 *   chore(INFRA): bump turbo to 2.1.3
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "style",
      ],
    ],
    "scope-empty": [2, "never"],
    "scope-case": [2, "always", "upper-case"],
    "subject-case": [0], // free-form; PR title check handles high-level format
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 120],
  },
  // NB: scope validation (SF-XX / KERNEL-X / INFRA / DOCS) is enforced by
  // .github/workflows/pr-title-check.yml on PR titles rather than every commit,
  // to allow WIP commits that get squash-merged.
};
