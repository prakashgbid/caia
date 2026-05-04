import { describe, it, expect } from 'vitest';
import { SITES, getSiteConfig, getAllSiteNames } from '../src/sites-config';

describe('sites-config', () => {
  it('should have three sites configured', () => {
    expect(SITES.length).toBe(3);
  });

  it('should have dashboard site', () => {
    const dashboard = SITES.find((s) => s.name === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.port).toBe(5173);
    expect(dashboard!.branch).toBe('develop');
  });

  it('should have poker-zeno site', () => {
    const pokerZeno = SITES.find((s) => s.name === 'poker-zeno');
    expect(pokerZeno).toBeDefined();
    expect(pokerZeno!.port).toBe(5174);
    expect(pokerZeno!.branch).toBe('develop');
  });

  it('should have roulette-community site', () => {
    const roulette = SITES.find((s) => s.name === 'roulette-community');
    expect(roulette).toBeDefined();
    expect(roulette!.port).toBe(5175);
    expect(roulette!.branch).toBe('develop');
  });

  it('should have unique ports', () => {
    const ports = SITES.map((s) => s.port);
    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(SITES.length);
  });

  it('should get site config by name', () => {
    const config = getSiteConfig('dashboard');
    expect(config.name).toBe('dashboard');
    expect(config.port).toBe(5173);
  });

  it('should throw on unknown site name', () => {
    expect(() => getSiteConfig('unknown-site')).toThrow('Unknown site');
  });

  it('should return all site names', () => {
    const names = getAllSiteNames();
    expect(names).toContain('dashboard');
    expect(names).toContain('poker-zeno');
    expect(names).toContain('roulette-community');
    expect(names.length).toBe(3);
  });

  it('should have build commands', () => {
    for (const site of SITES) {
      expect(site.buildCmd).toBeTruthy();
      expect(site.buildCmd.length).toBeGreaterThan(0);
    }
  });

  it('should have start commands as functions', () => {
    for (const site of SITES) {
      expect(typeof site.startCmd).toBe('function');
      const cmd = site.startCmd(9999);
      expect(cmd).toContain('9999');
    }
  });

  it('should have health check paths and content matchers', () => {
    for (const site of SITES) {
      expect(site.healthPath).toBeDefined();
      expect(site.healthMustContain).toBeDefined();
      expect(site.healthPath.startsWith('/')).toBe(true);
      expect(site.healthMustContain.length).toBeGreaterThan(0);
    }
  });

  it('should have build artifacts list', () => {
    for (const site of SITES) {
      expect(Array.isArray(site.buildArtifacts)).toBe(true);
      expect(site.buildArtifacts.length).toBeGreaterThan(0);
    }
  });
});
