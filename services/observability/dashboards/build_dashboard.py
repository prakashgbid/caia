#!/usr/bin/env python3
"""
Build CAIA Autonomous System — 24h Walkaway View dashboard JSON.
Output: caia-autonomous-system.json
"""
import json
from copy import deepcopy

DS = {"type": "prometheus", "uid": "caia-prom"}
LOKI = {"type": "loki", "uid": "P8E80F9AEF21F6940"}

PANEL_ID = 0
def nid():
    global PANEL_ID
    PANEL_ID += 1
    return PANEL_ID

def row(title, y):
    return {
        "type": "row", "title": title, "id": nid(),
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "collapsed": False, "panels": [],
    }

def stat(title, expr, x, y, w, h, *,
         unit="short", thresholds=None, mappings=None,
         color_mode="value", graph_mode="none", reduce_calc="lastNotNull",
         legend=None, decimals=None, no_value="—"):
    fc = {
        "color": {"mode": "thresholds"},
        "mappings": mappings or [],
        "unit": unit,
        "noValue": no_value,
    }
    if thresholds is not None:
        fc["thresholds"] = thresholds
    else:
        fc["thresholds"] = {"mode": "absolute", "steps": [
            {"color": "green", "value": None},
        ]}
    if decimals is not None:
        fc["decimals"] = decimals
    return {
        "id": nid(), "type": "stat", "title": title,
        "datasource": DS, "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "fieldConfig": {"defaults": fc, "overrides": []},
        "options": {
            "colorMode": color_mode,
            "graphMode": graph_mode,
            "justifyMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": [reduce_calc], "fields": "", "values": False},
            "textMode": "auto",
            "wideLayout": True,
        },
        "pluginVersion": "11.0.0",
        "targets": [{"datasource": DS, "expr": expr, "refId": "A",
                     "legendFormat": legend or "{{__name__}}"}],
    }

def gauge(title, expr, x, y, w, h, *, unit="short", min_=0, max_=None,
          thresholds=None, legend=""):
    fc = {
        "color": {"mode": "thresholds"},
        "mappings": [],
        "unit": unit,
        "min": min_,
        "max": max_,
        "thresholds": thresholds or {"mode": "absolute", "steps": [
            {"color": "green", "value": None},
            {"color": "yellow", "value": 60},
            {"color": "red", "value": 80},
        ]},
    }
    return {
        "id": nid(), "type": "gauge", "title": title,
        "datasource": DS, "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "fieldConfig": {"defaults": fc, "overrides": []},
        "options": {
            "orientation": "auto",
            "showThresholdLabels": False,
            "showThresholdMarkers": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        "pluginVersion": "11.0.0",
        "targets": [{"datasource": DS, "expr": expr, "refId": "A",
                     "legendFormat": legend}],
    }

def timeseries(title, targets, x, y, w, h, *, unit="short",
               legend_placement="bottom", stacking=None, fill_opacity=10,
               line_width=1, draw_style="line", show_points="never",
               y_min=None, y_max=None, soft_min=None, soft_max=None):
    custom = {
        "drawStyle": draw_style,
        "lineInterpolation": "linear",
        "lineWidth": line_width,
        "fillOpacity": fill_opacity,
        "spanNulls": False,
        "showPoints": show_points,
        "pointSize": 4,
        "scaleDistribution": {"type": "linear"},
        "stacking": stacking or {"mode": "none", "group": "A"},
        "axisPlacement": "auto",
        "axisLabel": "",
        "axisColorMode": "text",
        "axisGridShow": True,
    }
    if soft_min is not None:
        custom["axisSoftMin"] = soft_min
    if soft_max is not None:
        custom["axisSoftMax"] = soft_max
    fc = {
        "color": {"mode": "palette-classic"},
        "custom": custom,
        "mappings": [],
        "thresholds": {"mode": "absolute", "steps": [
            {"color": "green", "value": None},
        ]},
        "unit": unit,
    }
    if y_min is not None:
        fc["min"] = y_min
    if y_max is not None:
        fc["max"] = y_max
    panel = {
        "id": nid(), "type": "timeseries", "title": title,
        "datasource": DS, "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "fieldConfig": {"defaults": fc, "overrides": []},
        "options": {
            "legend": {"showLegend": True, "displayMode": "list",
                       "placement": legend_placement, "calcs": []},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "pluginVersion": "11.0.0",
        "targets": [],
    }
    for t in targets:
        panel["targets"].append({
            "datasource": DS,
            "expr": t["expr"],
            "legendFormat": t.get("legend", ""),
            "refId": t.get("refId", chr(65+len(panel["targets"]))),
        })
    return panel

def table(title, expr, x, y, w, h, *, format_="table",
          column_overrides=None, transformations=None):
    fc = {
        "color": {"mode": "thresholds"},
        "custom": {
            "align": "auto",
            "displayMode": "auto",
            "filterable": True,
            "inspect": False,
        },
        "mappings": [],
        "thresholds": {"mode": "absolute", "steps": [
            {"color": "green", "value": None},
        ]},
        "unit": "short",
    }
    panel = {
        "id": nid(), "type": "table", "title": title,
        "datasource": DS, "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "fieldConfig": {"defaults": fc, "overrides": column_overrides or []},
        "options": {
            "showHeader": True,
            "footer": {"show": False, "reducer": ["sum"], "fields": ""},
        },
        "pluginVersion": "11.0.0",
        "targets": [{"datasource": DS, "expr": expr, "refId": "A",
                     "instant": True, "format": format_}],
        "transformations": transformations or [],
    }
    return panel

def text(title, content, x, y, w, h):
    return {
        "id": nid(), "type": "text", "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "options": {"mode": "markdown", "content": content},
        "pluginVersion": "11.0.0",
    }


# ===== Build panels =====
panels = []
y = 0

# ----- Section 1: Health Overview -----
panels.append(row("Health Overview — is the system breathing?", y))
y += 1

# Service ups (5x stat)
panels.append(stat(
    "SPS",
    'up{job="caia-sps"}',
    x=0, y=y, w=4, h=4,
    mappings=[{"options": {"0": {"text": "DOWN", "color": "red"},
                            "1": {"text": "UP", "color": "green"}},
               "type": "value"}],
    thresholds={"mode": "absolute", "steps": [
        {"color": "red", "value": None},
        {"color": "green", "value": 1},
    ]},
    color_mode="background",
    legend="SPS",
))
panels.append(stat(
    "Slot Manager",
    'up{job="caia-slot-manager"}',
    x=4, y=y, w=4, h=4,
    mappings=[{"options": {"0": {"text": "DOWN", "color": "red"},
                            "1": {"text": "UP", "color": "green"}},
               "type": "value"}],
    thresholds={"mode": "absolute", "steps": [
        {"color": "red", "value": None},
        {"color": "green", "value": 1},
    ]},
    color_mode="background",
    legend="slot-manager",
))
panels.append(stat(
    "Active spawner hosts",
    'sum(slot_manager_hosts_total{state="active"})',
    x=8, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "red", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "green", "value": 2},
    ]},
    color_mode="value",
    graph_mode="area",
    legend="active",
))
panels.append(stat(
    "Disabled hosts",
    'sum(slot_manager_hosts_total{state="disabled"})',
    x=12, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
    ]},
    legend="disabled",
))
panels.append(stat(
    "In-flight (cluster total)",
    'sum(active_assignments_total)',
    x=16, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "blue", "value": None},
    ]},
    color_mode="value",
    graph_mode="area",
    legend="in-flight",
))
panels.append(stat(
    "DLQ open (slot-manager)",
    'slot_manager_dead_letter_open',
    x=20, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "red", "value": 5},
    ]},
    color_mode="background",
    legend="DLQ",
))
y += 4

# Autonomy state per scope (table)
panels.append(table(
    "Autonomy state by scope",
    'slot_manager_autonomy_state',
    x=0, y=y, w=12, h=6,
    transformations=[
        {"id": "labelsToFields", "options": {"mode": "columns"}},
        {"id": "organize", "options": {
            "excludeByName": {"Time": True, "__name__": True,
                              "instance": True, "job": True,
                              "service": True, "component": True},
            "renameByName": {"scope": "Scope", "state": "Configured State",
                             "Value": "Value"}
        }},
    ],
    column_overrides=[
        {
            "matcher": {"id": "byName", "options": "Configured State"},
            "properties": [
                {"id": "mappings", "value": [
                    {"type": "value", "options": {
                        "on": {"text": "ON", "color": "green", "index": 0},
                        "off": {"text": "OFF", "color": "yellow", "index": 1},
                        "circuit-broken": {"text": "CIRCUIT BROKEN", "color": "red", "index": 2},
                        "cap-throttled": {"text": "CAP THROTTLED", "color": "orange", "index": 3},
                    }},
                ]},
                {"id": "custom.cellOptions", "value": {"type": "color-text"}},
            ],
        },
    ],
))

# Hosts table — show registered hosts and state
panels.append(table(
    "Hosts registered (slot-manager view)",
    'slot_manager_hosts_total',
    x=12, y=y, w=12, h=6,
    transformations=[
        {"id": "labelsToFields", "options": {"mode": "columns"}},
        {"id": "organize", "options": {
            "excludeByName": {"Time": True, "__name__": True,
                              "instance": True, "job": True,
                              "service": True, "component": True},
            "renameByName": {"state": "State", "Value": "Count"}
        }},
    ],
    column_overrides=[
        {
            "matcher": {"id": "byName", "options": "State"},
            "properties": [
                {"id": "mappings", "value": [
                    {"type": "value", "options": {
                        "active": {"text": "ACTIVE", "color": "green", "index": 0},
                        "disabled": {"text": "DISABLED", "color": "red", "index": 1},
                        "draining": {"text": "DRAINING", "color": "yellow", "index": 2},
                        "cap-throttled": {"text": "CAP THROTTLED", "color": "orange", "index": 3},
                    }},
                ]},
                {"id": "custom.cellOptions", "value": {"type": "color-text"}},
            ],
        },
    ],
))
y += 6

# Build / version banner
panels.append(text(
    "CAIA build info",
    "**Slot Manager:** `slot_manager_up=1` indicates 0.4.0-phase4 alive.  \n"
    "**SPS:** see `sps_info{version,phase}` panel.  \n"
    "**Subscription guard:** `subscription_guard_at_startup=true` baked into both services. "
    "Any non-zero `caia_subscription_rejection_total` (synthetic — emitted on guard violation) "
    "fires the SubscriptionGuardViolation alert (page-immediately).",
    x=0, y=y, w=24, h=2,
))
y += 2

# ----- Section 2: Throughput -----
panels.append(row("Throughput — how fast are we draining?", y))
y += 1

# Spawns/hour per host
panels.append(timeseries(
    "Spawns/hour by host (slot-manager started)",
    [
        {"expr": 'sum by (host) (rate(slot_spawn_started_total{host!=""}[5m])) * 3600',
         "legend": "{{host}}"},
    ],
    x=0, y=y, w=12, h=8, unit="short",
))
# Claims/hour per bucket
panels.append(timeseries(
    "Loop claims/hour by bucket",
    [
        {"expr": 'rate(slot_loop_claims_total[5m]) * 3600',
         "legend": "loop_claims"},
        {"expr": 'sum by (bucket) (slot_claims_per_hour)',
         "legend": "{{bucket}} (rolling)", "refId": "B"},
    ],
    x=12, y=y, w=12, h=8, unit="short",
))
y += 8

# Success rate (1 - failed/total)
panels.append(timeseries(
    "Spawn success rate (%)",
    [
        {"expr": '100 * (1 - (sum(rate(slot_spawn_completed_total{outcome!="ok",outcome!=""}[10m])) / clamp_min(sum(rate(slot_spawn_completed_total{outcome!=""}[10m])), 1)))',
         "legend": "success %"},
    ],
    x=0, y=y, w=8, h=7, unit="percent",
    y_min=0, y_max=100,
))
panels.append(timeseries(
    "Spawn duration p50/p95 (slot-manager view, by bucket)",
    [
        {"expr": 'histogram_quantile(0.50, sum by (le, bucket) (rate(slot_spawn_duration_seconds_bucket{bucket!=""}[5m])))',
         "legend": "p50 {{bucket}}"},
        {"expr": 'histogram_quantile(0.95, sum by (le, bucket) (rate(slot_spawn_duration_seconds_bucket{bucket!=""}[5m])))',
         "legend": "p95 {{bucket}}", "refId": "B"},
    ],
    x=8, y=y, w=10, h=7, unit="s",
))
panels.append(stat(
    "DLQ size",
    'sum(slot_manager_dead_letter_open) + sum(sps_dead_letter_total)',
    x=18, y=y, w=6, h=7,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "red", "value": 5},
    ]},
    color_mode="background", graph_mode="area",
    legend="DLQ",
))
y += 7

# SPS spawn latency p50/p95 (from sps_spawn_latency_ms)
panels.append(timeseries(
    "SPS claim latency p50/p95 (ms, from in-process ring)",
    [
        {"expr": 'sps_spawn_latency_ms{quantile="0.5"}',
         "legend": "p50"},
        {"expr": 'sps_spawn_latency_ms{quantile="0.95"}',
         "legend": "p95", "refId": "B"},
    ],
    x=0, y=y, w=12, h=6, unit="ms",
))
# SPS spawns/retries totals
panels.append(timeseries(
    "SPS spawn / retry / dead-letter rates (events/min)",
    [
        {"expr": 'rate(sps_spawn_total[5m]) * 60',
         "legend": "sps_spawn /min"},
        {"expr": 'rate(sps_retry_total[5m]) * 60',
         "legend": "sps_retry /min", "refId": "B"},
        {"expr": 'rate(sps_dead_letter_total[5m]) * 60',
         "legend": "sps_dead_letter /min", "refId": "C"},
    ],
    x=12, y=y, w=12, h=6, unit="short",
))
y += 6

# ----- Section 3: Failure breakdown -----
panels.append(row("Failure breakdown — what went wrong?", y))
y += 1

# Failures by reason (outcome label) — slot-manager view
panels.append(timeseries(
    "Slot-manager terminal outcomes /min (excluding ok)",
    [
        {"expr": 'sum by (outcome) (rate(slot_spawn_completed_total{outcome!="ok",outcome!=""}[5m])) * 60',
         "legend": "{{outcome}}"},
    ],
    x=0, y=y, w=12, h=8, unit="short",
    stacking={"mode": "normal", "group": "A"},
))

# SPS completions by outcome
panels.append(timeseries(
    "SPS completions /min by outcome",
    [
        {"expr": 'sum by (outcome) (rate(sps_completion_total[5m])) * 60',
         "legend": "{{outcome}}"},
    ],
    x=12, y=y, w=12, h=8, unit="short",
    stacking={"mode": "normal", "group": "A"},
))
y += 8

# Loop skip reasons (cap_exceeded synonym = throttled, etc.)
panels.append(timeseries(
    "Autonomous loop skip reasons /min (no_work / no_slot / budget / throttled)",
    [
        {"expr": 'sum by (reason) (rate(slot_loop_skips_total[5m])) * 60',
         "legend": "{{reason}}"},
    ],
    x=0, y=y, w=12, h=7, unit="short",
    stacking={"mode": "normal", "group": "A"},
))

# Top 10 failing tasks — pulled via Loki (slot-manager logs spawn_id + task_id on terminal)
panels.append({
    "id": nid(), "type": "logs", "title": "Top recent slot-manager failures (Loki)",
    "datasource": LOKI,
    "gridPos": {"h": 7, "w": 12, "x": 12, "y": y},
    "options": {
        "showTime": True, "showLabels": False, "wrapLogMessage": True,
        "prettifyLogMessage": False, "enableLogDetails": True,
        "dedupStrategy": "none", "sortOrder": "Descending",
    },
    "targets": [{
        "datasource": LOKI,
        "expr": '{container=~".*slot-manager.*"} |~ "(?i)(outcome=failed|outcome=cap_throttled|outcome=parse_error|outcome=interrupted|guard_failed|rejected_)"',
        "refId": "A",
    }],
})
y += 7

# Retry budget exhausted — count of dead-letter
panels.append(stat(
    "Retry-budget exhausted (DLQ rows total)",
    'slot_manager_dead_letter_open + sum(sps_dead_letter_total)',
    x=0, y=y, w=8, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "red", "value": 10},
    ]},
    color_mode="value", graph_mode="area",
    legend="DLQ",
))
panels.append(stat(
    "Loop ticks last 24h",
    'increase(slot_loop_iterations_total[24h])',
    x=8, y=y, w=8, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "blue", "value": None},
    ]},
    legend="ticks",
))
panels.append(stat(
    "Loop claims last 24h",
    'increase(slot_loop_claims_total[24h])',
    x=16, y=y, w=8, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "blue", "value": None},
    ]},
    legend="claims",
))
y += 4

# ----- Section 4: Resource utilization -----
panels.append(row("Resource utilization — slots / budgets / host pressure", y))
y += 1

# Slots in use vs free by bucket
panels.append(timeseries(
    "Slots in use vs free (cluster, by bucket)",
    [
        {"expr": 'slot_in_use_total',
         "legend": "in_use {{bucket}}"},
        {"expr": 'slot_free_total',
         "legend": "free {{bucket}}", "refId": "B"},
    ],
    x=0, y=y, w=12, h=8, unit="short",
    stacking={"mode": "normal", "group": "A"},
))

# Spawn budget tokens remaining
panels.append(timeseries(
    "Spawn budget — tokens remaining vs cap (per bucket)",
    [
        {"expr": 'spawn_budget_tokens_remaining',
         "legend": "tokens left {{bucket}}"},
        {"expr": 'spawn_budget_max_per_minute',
         "legend": "cap/min {{bucket}}", "refId": "B"},
    ],
    x=12, y=y, w=12, h=8, unit="short",
))
y += 8

# Slot status detail per bucket
panels.append(timeseries(
    "Slot status by bucket (free / claimed / occupied / draining / disabled)",
    [
        {"expr": 'sum by (bucket, status) (slot_status_total)',
         "legend": "{{bucket}}/{{status}}"},
    ],
    x=0, y=y, w=24, h=8, unit="short",
))
y += 8

# Cadvisor host CPU/mem (best-effort)
panels.append(timeseries(
    "Stolution host CPU % (node_exporter)",
    [
        {"expr": '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
         "legend": "{{instance}} CPU%"},
    ],
    x=0, y=y, w=12, h=6, unit="percent", y_min=0, y_max=100,
))
panels.append(timeseries(
    "Stolution host memory used %",
    [
        {"expr": '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
         "legend": "{{instance}} mem%"},
    ],
    x=12, y=y, w=12, h=6, unit="percent", y_min=0, y_max=100,
))
y += 6

# ----- Section 5: Backlog progress (DAG state) -----
panels.append(row("Backlog progress — SPS DAG state", y))
y += 1

panels.append(stat(
    "Total ready",
    'sum(sps_bucket_ready)',
    x=0, y=y, w=4, h=4, color_mode="value", graph_mode="area",
    thresholds={"mode": "absolute", "steps": [{"color": "blue", "value": None}]},
    legend="ready",
))
panels.append(stat(
    "Total in-flight",
    'sum(sps_bucket_inflight)',
    x=4, y=y, w=4, h=4, color_mode="value", graph_mode="area",
    thresholds={"mode": "absolute", "steps": [{"color": "purple", "value": None}]},
    legend="inflight",
))
panels.append(stat(
    "Total queue depth",
    'sum(sps_bucket_queue_depth)',
    x=8, y=y, w=4, h=4, color_mode="value", graph_mode="area",
    thresholds={"mode": "absolute", "steps": [{"color": "blue", "value": None}]},
    legend="queue",
))
panels.append(stat(
    "Total stuck",
    'sum(sps_bucket_stuck)',
    x=12, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "red", "value": 5},
    ]},
    color_mode="background",
    legend="stuck",
))
panels.append(stat(
    "Total DLQ (SPS)",
    'sum(sps_bucket_dead_letter)',
    x=16, y=y, w=4, h=4,
    thresholds={"mode": "absolute", "steps": [
        {"color": "green", "value": None},
        {"color": "yellow", "value": 1},
        {"color": "red", "value": 5},
    ]},
    color_mode="background",
    legend="DLQ",
))
panels.append(stat(
    "Total completed (24h, success only)",
    'increase(sps_completion_total{outcome="done"}[24h])',
    x=20, y=y, w=4, h=4, color_mode="value", graph_mode="area",
    thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}]},
    legend="done",
))
y += 4

# Per-bucket detail table
panels.append(table(
    "Bucket detail (SPS view)",
    'sps_bucket_ready or sps_bucket_inflight or sps_bucket_queue_depth or sps_bucket_dead_letter or sps_bucket_stuck or sps_bucket_cap or sps_bucket_enabled',
    x=0, y=y, w=24, h=8,
    transformations=[
        {"id": "merge", "options": {}},
        {"id": "labelsToFields", "options": {"mode": "columns", "valueLabel": "__name__"}},
        {"id": "organize", "options": {
            "excludeByName": {"Time": True, "instance": True, "job": True,
                              "service": True, "component": True},
            "renameByName": {
                "bucket": "Bucket",
                "sps_bucket_ready": "Ready",
                "sps_bucket_inflight": "In-flight",
                "sps_bucket_queue_depth": "Queue depth",
                "sps_bucket_dead_letter": "DLQ",
                "sps_bucket_stuck": "Stuck",
                "sps_bucket_cap": "Cap",
                "sps_bucket_enabled": "Enabled",
            },
        }},
    ],
))
y += 8

# DAG drain trend
panels.append(timeseries(
    "Backlog trend — ready / in-flight / queue / DLQ / stuck (cluster total)",
    [
        {"expr": 'sum(sps_bucket_ready)', "legend": "ready"},
        {"expr": 'sum(sps_bucket_inflight)', "legend": "in-flight", "refId": "B"},
        {"expr": 'sum(sps_bucket_queue_depth)', "legend": "queue depth", "refId": "C"},
        {"expr": 'sum(sps_bucket_dead_letter)', "legend": "DLQ", "refId": "D"},
        {"expr": 'sum(sps_bucket_stuck)', "legend": "stuck", "refId": "E"},
    ],
    x=0, y=y, w=24, h=8, unit="short",
))
y += 8

# ----- Section 6: Lineage tree -----
panels.append(row("Lineage tree — parent → child spawn relationships (recent, depth ≥ 1)", y))
y += 1

# Loki query for lineage events from slot-manager logs
panels.append({
    "id": nid(), "type": "logs",
    "title": "Recent spawn lineage events (Loki, slot-manager logs)",
    "datasource": LOKI,
    "gridPos": {"h": 8, "w": 24, "x": 0, "y": y},
    "options": {
        "showTime": True, "showLabels": True, "wrapLogMessage": True,
        "prettifyLogMessage": False, "enableLogDetails": True,
        "dedupStrategy": "none", "sortOrder": "Descending",
    },
    "targets": [{
        "datasource": LOKI,
        "expr": '{container=~".*slot-manager.*"} |~ "(?i)(spawn_lineage|relation=(autonomous-claim|retry-of|replay-of|decomposed-into|continuation))"',
        "refId": "A",
    }],
})
y += 8

panels.append(text(
    "How to walk a lineage chain",
    "Click a `spawn_id` in the Loki panel above, then run from any shell with cluster access:\n\n"
    "```\nSM=10.43.173.170:8081\ncurl -sS http://$SM/spawn-lineage/<spawn_id> | jq\n```\n\n"
    "Returns ancestors (root → leaf) and immediate children. Relations: "
    "`autonomous-claim` (root), `retry-of` (after a transient outcome), "
    "`replay-of` (manual DLQ replay), `decomposed-into` (parent claude split work), "
    "`continuation` (operator restart of a long-running spawn).",
    x=0, y=y, w=24, h=4,
))
y += 4

# ----- Section 7: Subscription guard -----
panels.append(row("Subscription guard — zero-dollar invariant (must always be 0 violations)", y))
y += 1

# Subscription guard pass/violation counts (synthetic — slot-manager logs each guard pass)
panels.append({
    "id": nid(), "type": "logs",
    "title": "Subscription-guard events (Loki — slot-manager + spawner logs)",
    "datasource": LOKI,
    "gridPos": {"h": 7, "w": 24, "x": 0, "y": y},
    "options": {
        "showTime": True, "showLabels": True, "wrapLogMessage": True,
        "prettifyLogMessage": False, "enableLogDetails": True,
        "dedupStrategy": "none", "sortOrder": "Descending",
    },
    "targets": [{
        "datasource": LOKI,
        "expr": '{container=~".*(slot-manager|claude-spawner|sps).*"} |~ "(?i)(subscription_only|api_key_guard|ANTHROPIC_API_KEY|guard_failed|guard_passed|rejected_guard)"',
        "refId": "A",
    }],
})
y += 7

# Always-zero stat — derived from log counter
panels.append(text(
    "Subscription-guard invariants",
    "**Invariants (any breach = stop work, page operator immediately):**\n\n"
    "1. `slot_manager_autonomy_state{state=\"circuit-broken\"}` MUST be 0 due to API-key presence.\n"
    "2. Every `/spawn` MUST echo `subscription_only=true`. Loki query above filters to those events.\n"
    "3. No `rejected_guard` events should EVER appear post-deploy.\n\n"
    "If anything in the panel above shows `subscription_only=false`, "
    "`api_key_guard_failed`, or `rejected_guard`: stop, page, file an incident.",
    x=0, y=y, w=24, h=4,
))
y += 4

# ===== Build dashboard =====
dashboard = {
    "uid": "caia-walkaway",
    "title": "CAIA Autonomous System — 24h Walkaway View",
    "description": "Single-pane-of-glass for the operator to walk away for 24h and check health, throughput, failures, resources, backlog, lineage, and subscription guard. Comprehensive Observability deploy 2026-05-10.",
    "tags": ["caia", "autonomous", "slot-manager", "sps", "comprehensive-observability"],
    "schemaVersion": 39,
    "version": 1,
    "refresh": "30s",
    "time": {"from": "now-24h", "to": "now"},
    "timezone": "browser",
    "graphTooltip": 1,
    "editable": True,
    "fiscalYearStartMonth": 0,
    "liveNow": False,
    "weekStart": "",
    "annotations": {"list": [{
        "builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"},
        "enable": True, "hide": True,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts", "type": "dashboard",
    }]},
    "templating": {"list": [
        {
            "name": "bucket", "type": "query", "datasource": DS,
            "query": {"query": "label_values(slot_capacity_total, bucket)", "refId": "A"},
            "definition": "label_values(slot_capacity_total, bucket)",
            "current": {"selected": False, "text": "All", "value": "$__all"},
            "includeAll": True, "multi": True,
            "label": "Bucket (slot-manager)", "options": [],
            "refresh": 1, "regex": "", "skipUrlSync": False,
            "sort": 0, "tagValuesQuery": "", "tags": [],
            "tagsQuery": "", "useTags": False, "hide": 0,
        },
    ]},
    "panels": panels,
}

with open("caia-autonomous-system.json", "w") as f:
    json.dump(dashboard, f, indent=2)

print(f"Built dashboard with {len(panels)} panels.")
print("Output: caia-autonomous-system.json")
