import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WAKE_FINGERPRINT_COMMENT_PREFIX,
  WAKE_WRAPPER_COMMENT_PREFIX,
  extractEmbeddedWakeFingerprint,
  extractWakeWrapperTarget,
  fingerprintRenderedWake,
  fingerprintWakeTemplate,
  normalizeWakeTemplate,
  verifyWakeFingerprint,
} from '../src/wake-fingerprint.js';
import {
  canonicalWakeTemplateFingerprint,
  generateWake,
  loadCanonicalWakeTemplate,
  renderLegacyWakeWrapper,
  stampWakeFingerprint,
} from '../src/wake-generator.js';

// B4 tests — wake-script fingerprint + generator. Mirrors dispatcher-fingerprint.test.ts.

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'templates',
);
const CANONICAL_TEMPLATE = join(TEMPLATES_DIR, 'wake.sh.template');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'caia-wake-fingerprint-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function renderTemplateText(tpl: string, chainId = 'demo-chain'): string {
  return tpl
    .replace(/\{\{CHAIN_ID\}\}/g, chainId)
    .replace(/\{\{PHASES_FILE\}\}/g, '/tmp/x.yaml')
    .replace(/\{\{RUNNER_SCRIPT\}\}/g, '/tmp/runner.sh')
    .replace(/\{\{CAIA_CHAIN_BIN\}\}/g, '/usr/bin/caia-chain')
    .replace(/\{\{LOG_SLUG\}\}/g, chainId.replace(/-/g, '_'))
    .replace(/\{\{GENERATED_AT\}\}/g, '2026-05-15T12:00:00Z');
}

describe('normalizeWakeTemplate', () => {
  it('collapses placeholder tokens to a single sentinel', () => {
    const body = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"\nRUNNER_SCRIPT="{{RUNNER_SCRIPT}}"\n';
    const n = normalizeWakeTemplate(body);
    expect(n).not.toContain('{{CHAIN_ID}}');
    expect(n).not.toContain('{{RUNNER_SCRIPT}}');
    expect(n.match(/__CAIA_PH__/g)?.length).toBe(2);
  });

  it('fingerprint is stable across whitespace-equal templates', () => {
    const a = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"';
    expect(fingerprintWakeTemplate(a)).toBe(fingerprintWakeTemplate(a));
  });

  it('fingerprint changes when non-placeholder text changes', () => {
    const a = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"';
    const b = '#!/bin/bash\nset -u\nCHAIN_ID="{{CHAIN_ID}}"';
    expect(fingerprintWakeTemplate(a)).not.toBe(fingerprintWakeTemplate(b));
  });
});

describe('normalizeRenderedWake', () => {
  it('round-trips: template fingerprint == rendered fingerprint', () => {
    const tpl = readFileSync(CANONICAL_TEMPLATE, 'utf8');
    const tplHash = fingerprintWakeTemplate(tpl);
    const rendered = renderTemplateText(tpl, 'redflag-remediation');
    expect(fingerprintRenderedWake(rendered)).toBe(tplHash);
  });

  it('rendered hash is invariant across chain ids', () => {
    const tpl = readFileSync(CANONICAL_TEMPLATE, 'utf8');
    const a = fingerprintRenderedWake(renderTemplateText(tpl, 'redflag-remediation'));
    const b = fingerprintRenderedWake(renderTemplateText(tpl, 'apprentice-pull-forward'));
    const c = fingerprintRenderedWake(renderTemplateText(tpl, 'chain-runner-battle-harden'));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('stamping the fingerprint preserves the hash', () => {
    const tpl = readFileSync(CANONICAL_TEMPLATE, 'utf8');
    const tplHash = fingerprintWakeTemplate(tpl);
    const rendered = renderTemplateText(tpl, 'demo-chain');
    const stamped = stampWakeFingerprint(rendered, tplHash, {
      chainId: 'demo-chain',
      templatePath: CANONICAL_TEMPLATE,
    });
    expect(fingerprintRenderedWake(stamped)).toBe(tplHash);
    expect(extractEmbeddedWakeFingerprint(stamped)).toBe(tplHash);
  });
});

describe('canonicalWakeTemplateFingerprint', () => {
  it('matches loading + hashing the file directly', () => {
    const fp = canonicalWakeTemplateFingerprint();
    const { templateBody } = loadCanonicalWakeTemplate();
    expect(fp).toBe(fingerprintWakeTemplate(templateBody));
  });
});

describe('generateWake', () => {
  it('writes a fingerprint-stamped wake script that verifies', () => {
    const out = join(tmp, 'demo-chain.sh');
    const r = generateWake({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/phases.yaml',
      runnerScript: '/tmp/runner.sh',
      out,
    });
    expect(r.wakeScriptPath).toBe(out);
    expect(r.legacyWrapperPath).toBeNull();
    const body = readFileSync(out, 'utf8');
    expect(body).toContain(WAKE_FINGERPRINT_COMMENT_PREFIX);
    expect(body).toContain('CHAIN_ID="demo-chain"');
    expect(body).toContain('RUNNER_SCRIPT="/tmp/runner.sh"');
    const verdict = verifyWakeFingerprint(out, r.fingerprint);
    expect(verdict.ok).toBe(true);
  });

  it('refuses to overwrite without --force', () => {
    const out = join(tmp, 'collide.sh');
    writeFileSync(out, '# stub\n');
    expect(() =>
      generateWake({
        chainId: 'demo-chain',
        phasesYaml: '/tmp/phases.yaml',
        out,
      }),
    ).toThrow(/already exists/);
  });

  it('writes legacy wrapper when requested', () => {
    const canonical = join(tmp, 'canonical.sh');
    const wrapper = join(tmp, 'wrapper.sh');
    const r = generateWake({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/phases.yaml',
      out: canonical,
      writeLegacyWrapper: true,
      legacyWrapperPath: wrapper,
    });
    expect(r.legacyWrapperPath).toBe(wrapper);
    const wrapperBody = readFileSync(wrapper, 'utf8');
    expect(wrapperBody).toContain(`${WAKE_WRAPPER_COMMENT_PREFIX}${canonical}`);
    expect(extractWakeWrapperTarget(wrapperBody)).toBe(canonical);
    // wrapper itself has no fingerprint — verifier follows the marker.
    const verdict = verifyWakeFingerprint(wrapper, r.fingerprint);
    expect(verdict.ok).toBe(true);
  });
});

describe('verifyWakeFingerprint', () => {
  it('catches drift via body-hash mismatch when script edited after stamping', () => {
    const out = join(tmp, 'drift.sh');
    const r = generateWake({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/phases.yaml',
      out,
    });
    // Inject a non-templated change.
    const body = readFileSync(out, 'utf8');
    const tampered = body.replace('set -u', 'set -eu\n# injected drift');
    writeFileSync(out, tampered);
    const verdict = verifyWakeFingerprint(out, r.fingerprint);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('mismatch');
    }
  });

  it('catches outdated template (embedded ≠ expected)', () => {
    const out = join(tmp, 'outdated.sh');
    const r = generateWake({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/phases.yaml',
      out,
    });
    const verdict = verifyWakeFingerprint(out, 'deadbeef'.repeat(8));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('mismatch');
    }
  });

  it('returns wrapper_target_missing when wrapper points at a missing canonical', () => {
    const wrapper = join(tmp, 'orphan-wrapper.sh');
    writeFileSync(wrapper, renderLegacyWakeWrapper(join(tmp, 'does-not-exist.sh'), 'demo-chain'));
    const verdict = verifyWakeFingerprint(wrapper, 'deadbeef'.repeat(8));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('wrapper_target_missing');
    }
  });

  it('returns not_a_caia_wake (non-strict) for unmarked scripts', () => {
    const path = join(tmp, 'bespoke.sh');
    writeFileSync(path, '#!/bin/bash\necho hi\n');
    const verdict = verifyWakeFingerprint(path, canonicalWakeTemplateFingerprint());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('not_a_caia_wake');
    }
  });

  it('returns missing (strict) for unmarked scripts', () => {
    const path = join(tmp, 'bespoke-strict.sh');
    writeFileSync(path, '#!/bin/bash\necho hi\n');
    const verdict = verifyWakeFingerprint(path, canonicalWakeTemplateFingerprint(), {
      strict: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('missing');
    }
  });
});
