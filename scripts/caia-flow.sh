#!/usr/bin/env bash
# scripts/caia-flow.sh — the canonical CAIA git-flow lifecycle wrapper.
#
# The ONLY sanctioned path. Subcommands wrap a feature → develop → main
# lifecycle on top of `git` + `gh`, so every developer (and every Claude
# session) follows the same rails:
#
#   pnpm flow start <id>-<slug>     # cut feature/<id>-<slug> off origin/develop
#   pnpm flow ready                 # push + open (or mark ready) the draft PR
#   pnpm flow ship                  # gh pr merge --squash --auto --delete-branch
#   pnpm flow release [--date YYYY-MM-DD] [--auto]
#                                   # open release/<date> PR develop → main
#   pnpm flow status                # current branch + PR + CI snapshot
#   pnpm flow archive <reason>      # rename current branch to backup/<...>
#   pnpm flow recover <backup-ref>  # cut new feature/ branch from a backup/
#
# Reference: feedback_git_flow_enforced.md, caia/docs/git-flow.md.

set -euo pipefail

# ─── helpers ──────────────────────────────────────────────────────────

die() { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }
ok() { echo "✓ $*"; }

# Canonical allowed-prefix regex — keep in sync with
# .github/workflows/gitflow-conformance.yml and caia/docs/git-flow.md.
ALLOWED_PREFIX_RE='^(feat|feature|fix|chore|docs|refactor|perf|test|build|ci|harden|arch|acr|freg|bucket|lai|dash|gate|phase2e|coding|taskmgr|val)(/|-)'

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null \
    || die "not inside a git repository."
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree is dirty. Commit, stash to backup/*, or clean up first.
   See: pnpm flow archive <reason>  (preserve uncommitted work)
        git stash branch backup/<slug>  (stash → backup branch)"
  fi
}

require_branch_prefix() {
  local b
  b="$(current_branch)"
  if [[ "${b}" =~ ${ALLOWED_PREFIX_RE} ]]; then
    return 0
  fi
  die "current branch '${b}' does not start with an approved prefix.
   Approved prefixes (with '/' or '-' separator): feat, feature, fix, chore,
   docs, refactor, perf, test, build, ci, harden, arch, acr, freg, bucket,
   lai, dash, gate, phase2e, coding, taskmgr, val.
   Run 'pnpm flow start <id>-<slug>' to cut a new feature branch."
}

usage_top() {
  cat <<'EOF'
caia-flow — canonical CAIA git-flow lifecycle.

Usage:
  pnpm flow <subcommand> [args...]
  pnpm flow help [<subcommand>]

Subcommands:
  start <id>-<slug>           Cut feature/<id>-<slug> from origin/develop.
  ready                       Push + open (or mark ready) the PR vs develop.
  ship                        Squash-merge PR when CI green; delete branch.
  release [--date YYYY-MM-DD] Open release/<date> PR develop → main.
          [--auto]            Auto-merge release PR when CI green.
  status                      Current branch, base, PR, CI checks.
  archive <reason>            Rename current branch to backup/<branch>-<reason>.
  recover <backup-ref>        Cut new feature/ branch from a backup/ branch.
  help [<subcommand>]         This message, or detail on a subcommand.

Flow (the only allowed path):

  <prefix>/<id>-<slug>  →  PR to develop  →  squash-merge  →  branch deleted
  develop               →  release/<date> PR to main       →  merge
  main                  ←  only develop or release/* may merge in
  backup/<reason>       ←  preservation only, never merged

Approved <prefix> values (separator '/' or '-'):
  feat, feature, fix, chore, docs, refactor, perf, test, build, ci,
  harden, arch, acr, freg, bucket, lai, dash, gate, phase2e, coding,
  taskmgr, val.

Reference: caia/docs/git-flow.md, feedback_git_flow_enforced.md.
EOF
}

# ─── start ────────────────────────────────────────────────────────────

cmd_start() {
  local slug="${1:-}"
  [[ -n "${slug}" ]] || die "missing <id>-<slug>. Example: pnpm flow start fix-013-test-isolation"

  # If user supplied an already-prefixed branch, leave it alone; otherwise
  # default to feature/<slug>.
  if [[ ! "${slug}" =~ ${ALLOWED_PREFIX_RE} ]]; then
    slug="feature/${slug}"
  fi

  info "fetching origin/develop"
  git fetch origin develop --quiet

  if git rev-parse --verify --quiet "${slug}" >/dev/null; then
    die "branch '${slug}' already exists. Pick a different slug or 'git checkout ${slug}'."
  fi

  info "cutting ${slug} from origin/develop"
  git checkout -b "${slug}" origin/develop
  ok "on ${slug}. Make your commits, then 'pnpm flow ready'."
}

# ─── ready ────────────────────────────────────────────────────────────

cmd_ready() {
  require_branch_prefix
  local b
  b="$(current_branch)"

  info "pushing ${b}"
  git push -u origin "${b}"

  # Existing PR?
  local pr_num
  pr_num=$(gh pr list --state open --head "${b}" --base develop --limit 1 --json number --jq '.[0].number' || true)

  if [[ -z "${pr_num}" ]]; then
    info "opening PR ${b} → develop"
    gh pr create \
      --base develop \
      --head "${b}" \
      --fill \
      --title "${b}" \
      --body "Opened by \`pnpm flow ready\`. See caia/docs/git-flow.md."
    pr_num=$(gh pr list --state open --head "${b}" --base develop --limit 1 --json number --jq '.[0].number')
  else
    info "found existing PR #${pr_num}"
  fi

  # Mark ready (no-op if already ready).
  gh pr ready "${pr_num}" 2>/dev/null || true

  ok "PR #${pr_num} ready. Ship with: pnpm flow ship"
  gh pr view "${pr_num}" --web 2>/dev/null || gh pr view "${pr_num}"
}

# ─── ship ─────────────────────────────────────────────────────────────

cmd_ship() {
  require_branch_prefix
  local b
  b="$(current_branch)"

  local pr_num
  pr_num=$(gh pr list --state open --head "${b}" --base develop --limit 1 --json number --jq '.[0].number' || true)

  [[ -n "${pr_num}" ]] || die "no open PR for ${b} → develop. Run 'pnpm flow ready' first."

  info "enabling auto-merge (squash) on PR #${pr_num}"
  gh pr merge "${pr_num}" --squash --auto --delete-branch

  ok "auto-merge enabled. PR #${pr_num} will land when all checks are green."
  echo
  echo "  After merge, the remote branch is auto-deleted by GitHub."
  echo "  Clean up local with:"
  echo
  echo "    git checkout develop && git pull && git branch -D ${b}"
  echo
  echo "  Or use 'pnpm flow status' to monitor merge progress."
}

# ─── release ──────────────────────────────────────────────────────────

cmd_release() {
  local date_str=""
  local auto=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --date) date_str="$2"; shift 2 ;;
      --auto) auto=1; shift ;;
      *) die "unknown release arg: $1" ;;
    esac
  done
  [[ -n "${date_str}" ]] || date_str="$(date -u +%Y-%m-%d)"

  info "fetching"
  git fetch origin --prune --quiet

  local rb="release/${date_str}"
  if git ls-remote --exit-code --heads origin "${rb}" >/dev/null 2>&1; then
    info "remote ${rb} exists — using it."
  else
    info "creating ${rb} from origin/develop"
    git checkout -b "${rb}" origin/develop
    git push -u origin "${rb}"
  fi

  local existing
  existing=$(gh pr list --state open --head "${rb}" --base main --limit 1 --json number --jq '.[0].number' || true)
  if [[ -z "${existing}" ]]; then
    info "opening PR ${rb} → main"
    gh pr create \
      --base main \
      --head "${rb}" \
      --title "release(${date_str}): merge develop → main" \
      --body "Release PR — develop → main on ${date_str}.

Generated by \`pnpm flow release\`. Squash-merge when CI green.

Reference: caia/docs/git-flow.md."
    existing=$(gh pr list --state open --head "${rb}" --base main --limit 1 --json number --jq '.[0].number')
  else
    info "release PR already open: #${existing}"
  fi

  if [[ "${auto}" -eq 1 ]]; then
    info "enabling auto-merge on PR #${existing}"
    gh pr merge "${existing}" --merge --auto
  fi

  ok "release PR #${existing} ready. Track with 'pnpm flow status'."
}

# ─── status ───────────────────────────────────────────────────────────

cmd_status() {
  local b
  b="$(current_branch)"
  echo "branch:  ${b}"
  echo "remote:  $(git config "branch.${b}.remote" 2>/dev/null || echo '(unset)')"
  echo "tree:    $(git status --porcelain | wc -l | tr -d ' ') file(s) modified"
  echo

  local pr_json
  pr_json=$(gh pr list --state open --head "${b}" --limit 1 --json number,title,baseRefName,isDraft,statusCheckRollup,mergeStateStatus 2>/dev/null || echo "[]")
  if [[ "${pr_json}" == "[]" || -z "${pr_json}" ]]; then
    echo "PR:      (none open from ${b})"
    return 0
  fi

  python3 - <<PY
import json
prs = json.loads('''${pr_json}''')
if not prs:
    print("PR:      (none open)")
    raise SystemExit
p = prs[0]
print(f"PR:      #{p['number']}  →  {p['baseRefName']}{' [draft]' if p['isDraft'] else ''}")
print(f"title:   {p['title']}")
print(f"state:   {p['mergeStateStatus']}")
print("checks:")
for c in p.get('statusCheckRollup', []):
    name = c.get('name') or c.get('context','?')
    status = c.get('status','?')
    conclusion = c.get('conclusion','?')
    print(f"  - {name:50s} {status:10s} {conclusion or ''}")
PY
}

# ─── archive ──────────────────────────────────────────────────────────

cmd_archive() {
  local reason="${1:-}"
  [[ -n "${reason}" ]] || die "missing <reason>. Example: pnpm flow archive abandoned-rfc3339"
  local b old new
  b="$(current_branch)"
  old="${b}"
  case "${old}" in
    main|develop|release/*) die "cannot archive ${old}." ;;
  esac

  # sanitise reason for branch name.
  reason="$(echo "${reason}" | tr ' /' '--' | tr -cd '[:alnum:]._-')"
  new="backup/$(echo "${old}" | tr '/' '-')-${reason}"

  info "renaming ${old} → ${new}"
  git branch -m "${old}" "${new}"

  info "pushing ${new}"
  git push -u origin "${new}"

  info "deleting old remote branch ${old}"
  git push origin --delete "${old}" 2>/dev/null || true

  # Close any open PR from old branch.
  local pr_num
  pr_num=$(gh pr list --state open --head "${old}" --limit 1 --json number --jq '.[0].number' || true)
  if [[ -n "${pr_num}" ]]; then
    info "closing PR #${pr_num} (was tied to old branch)"
    gh pr close "${pr_num}" --comment "Branch archived to ${new} via 'pnpm flow archive'."
  fi

  ok "archived ${old} → ${new}. The branch is preserved on origin and will not be merged."
}

# ─── recover ──────────────────────────────────────────────────────────

cmd_recover() {
  local backup="${1:-}"
  [[ -n "${backup}" ]] || die "missing <backup-ref>. Example: pnpm flow recover backup/feat-xyz-abandoned"
  case "${backup}" in
    backup/*) ;;
    *) die "expected a backup/ ref, got '${backup}'." ;;
  esac

  info "fetching"
  git fetch origin --prune --quiet

  if ! git rev-parse --verify --quiet "origin/${backup}" >/dev/null; then
    die "remote ref 'origin/${backup}' not found."
  fi

  # Default new name: drop backup/ prefix, prepend feature/recover-
  local stem="${backup#backup/}"
  local new="feature/recover-${stem}"
  read -r -p "new branch name [${new}]: " input || true
  [[ -n "${input:-}" ]] && new="${input}"

  info "creating ${new} from origin/${backup}"
  git checkout -b "${new}" "origin/${backup}"

  ok "on ${new}. Rebase onto origin/develop with: git fetch && git rebase origin/develop"
}

# ─── help ─────────────────────────────────────────────────────────────

cmd_help() {
  local sub="${1:-}"
  case "${sub}" in
    start)
      cat <<EOF
pnpm flow start <id>-<slug>

Cuts a new feature branch from origin/develop. If <id>-<slug> already
starts with an approved prefix (feat/, feature/, fix/, chore/, docs/,
refactor/, perf/, test/, build/, ci/, harden/, arch/, acr/, freg/,
bucket/, lai/, dash/, gate/, phase2e/, coding/, taskmgr/, val/, with
'/' or '-' separator), it is used as-is. Otherwise the branch is
normalised to feature/<id>-<slug>.

Example:
  pnpm flow start fix-013-test-isolation
  pnpm flow start chore/clean-stale-tasks
  pnpm flow start arch/l5-router

Side effects:
  - git fetch origin develop
  - git checkout -b <branch> origin/develop
EOF
      ;;
    ready)
      cat <<EOF
pnpm flow ready

Pushes the current branch and opens (or marks ready) a PR vs develop.

Side effects:
  - git push -u origin <branch>
  - gh pr create OR gh pr ready
EOF
      ;;
    ship)
      cat <<EOF
pnpm flow ship

Enables auto-merge (squash) on the current branch's PR. The PR lands when
all required checks pass; the remote branch auto-deletes.

Side effects:
  - gh pr merge <num> --squash --auto --delete-branch
EOF
      ;;
    release)
      cat <<EOF
pnpm flow release [--date YYYY-MM-DD] [--auto]

Opens a release/<date> PR from develop into main. Default date = today UTC.
With --auto, enables auto-merge on the release PR.
EOF
      ;;
    status)
      cat <<EOF
pnpm flow status

Prints the current branch, working-tree dirtiness, the open PR (if any),
its target, draft state, mergeable state, and CI check rollup.
EOF
      ;;
    archive)
      cat <<EOF
pnpm flow archive <reason>

Renames the current branch to backup/<branch>-<reason>, pushes the new
remote, deletes the old remote branch, and closes any open PR. The work
is preserved off-Mac and never merged.

Example:
  pnpm flow archive 'spike-replaced-by-feat-bar'
EOF
      ;;
    recover)
      cat <<EOF
pnpm flow recover <backup-ref>

Cuts a new feature/ branch from a backup/* ref so abandoned work can be
resurrected without merging the backup/ branch itself.

Example:
  pnpm flow recover backup/feat-foo-abandoned
EOF
      ;;
    *) usage_top ;;
  esac
}

# ─── dispatch ─────────────────────────────────────────────────────────

main() {
  cd "$(repo_root)"
  local sub="${1:-help}"
  shift || true
  case "${sub}" in
    start)   cmd_start "$@" ;;
    ready)   cmd_ready "$@" ;;
    ship)    cmd_ship "$@" ;;
    release) cmd_release "$@" ;;
    status)  cmd_status "$@" ;;
    archive) cmd_archive "$@" ;;
    recover) cmd_recover "$@" ;;
    help|-h|--help) cmd_help "$@" ;;
    *) cmd_help; exit 2 ;;
  esac
}

main "$@"
