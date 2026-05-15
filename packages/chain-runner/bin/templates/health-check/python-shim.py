# >>> caia-plist-health-check-shim (phase A2)
if "--health-check" in __import__("sys").argv:
    import json as _hc_json, os as _hc_os, sys as _hc_sys
    from datetime import datetime as _hc_dt, timezone as _hc_tz
    _hc_sys.stdout.write(_hc_json.dumps({
        "ok": True,
        "label": _hc_os.environ.get("CAIA_PLIST_LABEL"),
        "script": __file__,
        "git_sha": _hc_os.environ.get("CAIA_GIT_SHA", "unknown"),
        "python": _hc_sys.version.split()[0],
        "pid": _hc_os.getpid(),
        "timestamp": _hc_dt.now(_hc_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }) + "\n")
    _hc_sys.exit(0)
# <<< caia-plist-health-check-shim
