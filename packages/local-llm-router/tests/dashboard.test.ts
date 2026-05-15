import { describe, it, expect } from 'vitest';
import { dashboardHtml } from '../src/dashboard.js';
import { buildApp } from '../src/server.js';

describe('A.9.8 — displacement dashboard', () => {
  it('returns a non-empty HTML document', () => {
    const html = dashboardHtml();
    expect(html.length).toBeGreaterThan(500);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('local-llm-router');
    expect(html).toContain('displacement');
  });

  it('embeds the four panels: displacement / escalation / saved / budget', () => {
    const html = dashboardHtml();
    expect(html).toContain('id="displacement"');
    expect(html).toContain('id="escalation"');
    expect(html).toContain('id="saved"');
    expect(html).toContain('id="budget"');
  });

  it('embeds the top-3 routing classes panel and per-task list', () => {
    const html = dashboardHtml();
    expect(html).toContain('id="top3"');
    expect(html).toContain('id="pertask"');
    expect(html).toContain('Top-3 routing classes');
  });

  it('polls /metrics every 5s — sets POLL_MS to 5000', () => {
    const html = dashboardHtml();
    expect(html).toMatch(/POLL_MS\s*=\s*5000/);
    expect(html).toContain("fetch('/metrics'");
  });

  it('parses the Prometheus exposition format for the five gauges + per-task counters', () => {
    const html = dashboardHtml();
    expect(html).toContain('llm_router_calls_total');
    expect(html).toContain('llm_router_local_share');
    expect(html).toContain('llm_router_saved_usd');
    expect(html).toContain('llm_router_avg_duration_ms');
    expect(html).toContain('llm_router_claude_budget_cap');
    expect(html).toContain('llm_router_claude_budget_calls_last_hour');
    expect(html).toContain('llm_router_task_calls_total');
  });

  it('server serves the dashboard at GET /dashboard with text/html', async () => {
    const app = buildApp();
    const res = await app.request('/dashboard');
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct.toLowerCase()).toContain('text/html');
    const body = await res.text();
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('local-llm-router');
  });

  it('uses the canonical 64.3% displacement floor in its classifier', () => {
    const html = dashboardHtml();
    // The classify() function uses the gap-analysis risk-register floor.
    expect(html).toContain('0.643');
  });
});
