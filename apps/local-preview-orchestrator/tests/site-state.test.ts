import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSiteState,
  readSiteState,
  writeSiteState,
  updateSiteState
} from '../src/site-state';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'site-state-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('site-state', () => {
  it('default state has expected shape', () => {
    const s = defaultSiteState('dashboard', 5173);
    expect(s.name).toBe('dashboard');
    expect(s.url).toBe('http://localhost:5173');
    expect(s.current_sha).toBeNull();
    expect(s.last_deploy_status).toBeNull();
    expect(s.process_state).toBe('unknown');
    expect(s.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readSiteState returns default when no file exists', () => {
    const s = readSiteState(dir, { name: 'dashboard', port: 5173 });
    expect(s.name).toBe('dashboard');
    expect(s.current_sha).toBeNull();
  });

  it('writeSiteState persists JSON', () => {
    const initial = defaultSiteState('dashboard', 5173);
    writeSiteState(dir, { ...initial, current_sha: 'abc1234' });
    const filePath = join(dir, 'state.json');
    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed.current_sha).toBe('abc1234');
  });

  it('updateSiteState merges patch on top of existing state', () => {
    const fallback = { name: 'dashboard', port: 5173 };
    writeSiteState(dir, { ...defaultSiteState('dashboard', 5173), current_sha: 'old-sha' });
    const updated = updateSiteState(dir, fallback, {
      current_sha: 'new-sha',
      last_deploy_status: 'success',
      last_deploy_duration_ms: 1234
    });
    expect(updated.current_sha).toBe('new-sha');
    expect(updated.last_deploy_status).toBe('success');
    expect(updated.last_deploy_duration_ms).toBe(1234);

    const reread = readSiteState(dir, fallback);
    expect(reread.current_sha).toBe('new-sha');
    expect(reread.last_deploy_status).toBe('success');
  });

  it('readSiteState returns default on malformed JSON', () => {
    const fallback = { name: 'dashboard', port: 5173 };
    const filePath = join(dir, 'state.json');
    writeFileSync(filePath, '{ not valid json', 'utf-8');
    const s = readSiteState(dir, fallback);
    expect(s.name).toBe('dashboard');
    expect(s.current_sha).toBeNull();
  });
});
