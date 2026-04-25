import type { CheckResult, EntityRef } from '../types';

export async function verifyUrls(entity: EntityRef): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const plans = entity.verificationPlan ?? [];

  for (const plan of plans) {
    if (!plan.startsWith('url_200:')) continue;

    // Extract URLs from the plan text
    const urls = plan.match(/https?:\/\/[^\s]+/g) ?? [];
    // Also check live URLs from description/acceptance criteria
    const allText = [entity.description ?? '', entity.expectedBehavior ?? '', ...(entity.acceptanceCriteria ?? [])].join(' ');
    const textUrls = allText.match(/https?:\/\/[^\s,)]+/g) ?? [];

    const toCheck = [...new Set([...urls, ...textUrls])];

    for (const url of toCheck) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeout);
        const body = await res.text();
        const ok = res.status < 400 && body.length > 500;
        results.push({
          checkKind: 'url_200',
          passed: ok,
          expected: `HTTP 200 with body >500 bytes at ${url}`,
          actual: `HTTP ${res.status}, body ${body.length} bytes`,
          severity: ok ? 'info' : (res.status === 404 ? 'critical' : 'warning'),
          message: ok ? `✅ ${url} OK (${res.status})` : `❌ ${url} returned ${res.status} with ${body.length}B body`,
          evidenceUrl: url,
        });
      } catch (err) {
        results.push({
          checkKind: 'url_200',
          passed: false,
          expected: `HTTP 200 at ${url}`,
          actual: `Connection failed: ${(err as Error).message}`,
          severity: 'warning',
          message: `❌ ${url} unreachable: ${(err as Error).message}`,
          evidenceUrl: url,
        });
      }
    }
  }

  return results;
}
