// >>> caia-plist-health-check-shim (phase A2)
if (process.argv.includes('--health-check')) {
  process.stdout.write(JSON.stringify({
    ok: true,
    label: process.env.CAIA_PLIST_LABEL ?? null,
    script: __filename,
    git_sha: process.env.CAIA_GIT_SHA ?? 'unknown',
    node: process.version,
    pid: process.pid,
    timestamp: new Date().toISOString(),
  }) + '\n');
  process.exit(0);
}
// <<< caia-plist-health-check-shim
