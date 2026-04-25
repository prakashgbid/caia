import type { Finding } from '../types.js';

export function auditSecurity(url: string, headers: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const h = (name: string) => headers[name.toLowerCase()] ?? '';

  const isHttps = url.startsWith('https://');

  if (!isHttps) {
    findings.push({ id: 'sec-no-https', dimension: 'security', severity: 'critical', url, message: 'Site not served over HTTPS', suggestedFix: 'Enable HTTPS and redirect HTTP→HTTPS', estimatedImpact: 10, estimatedEffort: 'M' });
  }

  // HSTS
  const hsts = h('strict-transport-security');
  if (!hsts) {
    findings.push({ id: 'sec-no-hsts', dimension: 'security', severity: 'major', url, message: 'Missing Strict-Transport-Security header', suggestedFix: 'Add "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload"', estimatedImpact: 4, estimatedEffort: 'S' });
  } else if (!hsts.includes('includeSubDomains')) {
    findings.push({ id: 'sec-hsts-no-subdomains', dimension: 'security', severity: 'minor', url, message: 'HSTS does not include subdomains', evidence: hsts, suggestedFix: 'Add includeSubDomains to HSTS header', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  // X-Content-Type-Options
  if (!h('x-content-type-options')) {
    findings.push({ id: 'sec-no-xcto', dimension: 'security', severity: 'major', url, message: 'Missing X-Content-Type-Options header', suggestedFix: 'Add "X-Content-Type-Options: nosniff"', estimatedImpact: 3, estimatedEffort: 'S' });
  }

  // X-Frame-Options / frame-ancestors CSP
  const xfo = h('x-frame-options');
  const csp = h('content-security-policy');
  if (!xfo && !csp.includes('frame-ancestors')) {
    findings.push({ id: 'sec-no-frame-options', dimension: 'security', severity: 'major', url, message: 'Missing clickjacking protection (X-Frame-Options or CSP frame-ancestors)', suggestedFix: 'Add "X-Frame-Options: SAMEORIGIN" or CSP frame-ancestors directive', estimatedImpact: 3, estimatedEffort: 'S' });
  }

  // Referrer-Policy
  const rp = h('referrer-policy');
  if (!rp) {
    findings.push({ id: 'sec-no-referrer-policy', dimension: 'security', severity: 'minor', url, message: 'Missing Referrer-Policy header', suggestedFix: 'Add "Referrer-Policy: strict-origin-when-cross-origin"', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  // Permissions-Policy
  if (!h('permissions-policy')) {
    findings.push({ id: 'sec-no-permissions-policy', dimension: 'security', severity: 'info', url, message: 'No Permissions-Policy header (optional but best practice)', suggestedFix: 'Add Permissions-Policy to restrict camera/mic/geolocation access', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  // Server header leaking version
  const server = h('server');
  if (server && server.match(/\d+\.\d+/)) {
    findings.push({ id: 'sec-server-version-leak', dimension: 'security', severity: 'info', url, message: `Server header leaks version: "${server}"`, suggestedFix: 'Configure server to omit version from Server header', estimatedImpact: 1, estimatedEffort: 'M' });
  }

  return findings;
}
