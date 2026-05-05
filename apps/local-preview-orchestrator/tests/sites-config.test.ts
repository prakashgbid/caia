import { describe, it, expect } from 'vitest';
import {
  SITES,
  getSiteConfig,
  getAllSiteNames,
  getDefaultBranch,
  resolveBranch,
  envVarNameForSiteBranch,
  buildSitesForEnv,
  detectPackageManager,
  resolveBuildCmdForWorkspace
} from '../src/sites-config';

describe('sites-config', () => {
  it('should have three sites configured', () => {
    expect(SITES.length).toBe(3);
  });

  it('should have dashboard site (default branch develop)', () => {
    const dashboard = SITES.find((s) => s.name === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.port).toBe(5173);
    expect(getDefaultBranch('dashboard')).toBe('develop');
  });

  it('should have poker-zeno site (default branch master, per Stage-6 verify)', () => {
    const pokerZeno = SITES.find((s) => s.name === 'poker-zeno');
    expect(pokerZeno).toBeDefined();
    expect(pokerZeno!.port).toBe(5174);
    expect(getDefaultBranch('poker-zeno')).toBe('master');
  });

  it('should have roulette-community site (default branch main, per Stage-6 verify)', () => {
    const roulette = SITES.find((s) => s.name === 'roulette-community');
    expect(roulette).toBeDefined();
    expect(roulette!.port).toBe(5175);
    expect(getDefaultBranch('roulette-community')).toBe('main');
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

  it('returns undefined defaultBranch for unknown site', () => {
    expect(getDefaultBranch('not-a-real-site')).toBeUndefined();
  });
});

describe('envVarNameForSiteBranch', () => {
  it('uppercases and hyphen->underscore', () => {
    expect(envVarNameForSiteBranch('dashboard')).toBe('LOCAL_PREVIEW_DASHBOARD_BRANCH');
    expect(envVarNameForSiteBranch('poker-zeno')).toBe('LOCAL_PREVIEW_POKER_ZENO_BRANCH');
    expect(envVarNameForSiteBranch('roulette-community')).toBe(
      'LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH'
    );
  });

  it('handles multi-hyphen names', () => {
    expect(envVarNameForSiteBranch('a-b-c-d')).toBe('LOCAL_PREVIEW_A_B_C_D_BRANCH');
  });
});

describe('resolveBranch', () => {
  it('returns default when env var is unset', () => {
    const branch = resolveBranch('dashboard', 'develop', {});
    expect(branch).toBe('develop');
  });

  it('returns default when env var is empty string', () => {
    const branch = resolveBranch('dashboard', 'develop', { LOCAL_PREVIEW_DASHBOARD_BRANCH: '' });
    expect(branch).toBe('develop');
  });

  it('returns the override when env var is set and valid', () => {
    const branch = resolveBranch('dashboard', 'develop', {
      LOCAL_PREVIEW_DASHBOARD_BRANCH: 'feature/foo'
    });
    expect(branch).toBe('feature/foo');
  });

  it('handles hyphenated site names', () => {
    const branch = resolveBranch('poker-zeno', 'master', {
      LOCAL_PREVIEW_POKER_ZENO_BRANCH: 'develop'
    });
    expect(branch).toBe('develop');
  });

  it('handles complex git ref names', () => {
    const cases = [
      'develop',
      'main',
      'master',
      'feature/abc',
      'release/v1.2.3',
      'fix/st_1dUqW-link-integrity',
      'user/foo+bar',
      'a/b/c',
      'v1.2.3-rc.4',
      '@scope/branch'
    ];
    for (const ref of cases) {
      expect(
        resolveBranch('dashboard', 'develop', { LOCAL_PREVIEW_DASHBOARD_BRANCH: ref })
      ).toBe(ref);
    }
  });

  it('throws when override contains shell metacharacters', () => {
    const cases = [
      'develop;rm -rf /',
      'develop && echo hi',
      'develop | cat',
      'develop`echo hi`',
      'develop$(echo hi)',
      'develop\nfoo',
      'develop bar', // space
      'develop"bar"',
      "develop'bar'",
      'develop\\foo'
    ];
    for (const bad of cases) {
      expect(() =>
        resolveBranch('dashboard', 'develop', { LOCAL_PREVIEW_DASHBOARD_BRANCH: bad })
      ).toThrow(/Invalid branch override/);
    }
  });

  it('different sites have independent overrides', () => {
    const env = {
      LOCAL_PREVIEW_DASHBOARD_BRANCH: 'develop',
      LOCAL_PREVIEW_POKER_ZENO_BRANCH: 'master'
    };
    expect(resolveBranch('dashboard', 'X', env)).toBe('develop');
    expect(resolveBranch('poker-zeno', 'X', env)).toBe('master');
    expect(resolveBranch('roulette-community', 'X', env)).toBe('X');
  });
});

describe('buildSitesForEnv', () => {
  it('returns the bake-in defaults when env is empty', () => {
    const sites = buildSitesForEnv({});
    expect(sites.find((s) => s.name === 'dashboard')!.branch).toBe('develop');
    expect(sites.find((s) => s.name === 'poker-zeno')!.branch).toBe('master');
    expect(sites.find((s) => s.name === 'roulette-community')!.branch).toBe('main');
  });

  it('applies overrides to the right sites independently', () => {
    const sites = buildSitesForEnv({
      LOCAL_PREVIEW_DASHBOARD_BRANCH: 'feature/foo',
      LOCAL_PREVIEW_POKER_ZENO_BRANCH: 'feature/bar'
    });
    expect(sites.find((s) => s.name === 'dashboard')!.branch).toBe('feature/foo');
    expect(sites.find((s) => s.name === 'poker-zeno')!.branch).toBe('feature/bar');
    expect(sites.find((s) => s.name === 'roulette-community')!.branch).toBe('main');
  });

  it('throws if one site has an invalid override', () => {
    expect(() =>
      buildSitesForEnv({
        LOCAL_PREVIEW_POKER_ZENO_BRANCH: 'master; rm -rf /'
      })
    ).toThrow(/Invalid branch override/);
  });

  it('returns a fresh array (does not mutate the live SITES export)', () => {
    const len = SITES.length;
    buildSitesForEnv({ LOCAL_PREVIEW_DASHBOARD_BRANCH: 'feature/foo' });
    expect(SITES.length).toBe(len);
    expect(SITES.find((s) => s.name === 'dashboard')!.branch).toBe('develop');
  });
});


describe('detectPackageManager', () => {
  it('returns pnpm when pnpm-lock.yaml exists', () => {
    const exists = (p: string): boolean => p.endsWith('pnpm-lock.yaml');
    expect(detectPackageManager('/some/dir', exists)).toBe('pnpm');
  });

  it('returns npm when package-lock.json exists and pnpm-lock.yaml does not', () => {
    const exists = (p: string): boolean => p.endsWith('package-lock.json');
    expect(detectPackageManager('/some/dir', exists)).toBe('npm');
  });

  it('returns yarn when only yarn.lock exists', () => {
    const exists = (p: string): boolean => p.endsWith('yarn.lock');
    expect(detectPackageManager('/some/dir', exists)).toBe('yarn');
  });

  it('returns unknown when no recognised lockfile exists', () => {
    const exists = (_p: string): boolean => false;
    expect(detectPackageManager('/some/dir', exists)).toBe('unknown');
  });

  it('prefers pnpm over npm + yarn when multiple lockfiles coexist', () => {
    const exists = (_p: string): boolean => true; // every lockfile present
    expect(detectPackageManager('/some/dir', exists)).toBe('pnpm');
  });

  it('prefers npm over yarn when both coexist (no pnpm)', () => {
    const exists = (p: string): boolean =>
      p.endsWith('package-lock.json') || p.endsWith('yarn.lock');
    expect(detectPackageManager('/some/dir', exists)).toBe('npm');
  });
});

describe('resolveBuildCmdForWorkspace', () => {
  const site = {
    name: 'test',
    repo: '/repo',
    branch: 'main',
    port: 9999,
    autodetectBuildCmd: true,
    buildCmd: 'echo BAKEIN',
    startCmd: (p: number): string => `start ${p}`,
    healthPath: '/',
    healthMustContain: '<html',
    buildArtifacts: ['dist']
  };

  it('returns bake-in when autodetectBuildCmd is false', () => {
    const exists = (_p: string): boolean => true; // would otherwise detect pnpm
    const cmd = resolveBuildCmdForWorkspace(
      { ...site, autodetectBuildCmd: false },
      '/wd',
      exists
    );
    expect(cmd).toBe('echo BAKEIN');
  });

  it('returns pnpm install + build when pnpm-lock.yaml is present', () => {
    const exists = (p: string): boolean => p.endsWith('pnpm-lock.yaml');
    expect(resolveBuildCmdForWorkspace(site, '/wd', exists)).toBe(
      'pnpm install --frozen-lockfile && pnpm build'
    );
  });

  it('returns npm ci + npm run build when only package-lock.json is present', () => {
    const exists = (p: string): boolean => p.endsWith('package-lock.json');
    expect(resolveBuildCmdForWorkspace(site, '/wd', exists)).toBe(
      'npm ci && npm run build'
    );
  });

  it('returns yarn install + yarn build when only yarn.lock is present', () => {
    const exists = (p: string): boolean => p.endsWith('yarn.lock');
    expect(resolveBuildCmdForWorkspace(site, '/wd', exists)).toBe(
      'yarn install --frozen-lockfile && yarn build'
    );
  });

  it('falls back to bake-in when no recognised lockfile is present', () => {
    const exists = (_p: string): boolean => false;
    expect(resolveBuildCmdForWorkspace(site, '/wd', exists)).toBe('echo BAKEIN');
  });
});

describe('SITE_DEFAULTS autodetectBuildCmd flags', () => {
  it('dashboard opts out of autodetect (CAIA monorepo workspace)', () => {
    expect(getSiteConfig('dashboard').autodetectBuildCmd).toBe(false);
  });

  it('poker-zeno opts in to autodetect', () => {
    expect(getSiteConfig('poker-zeno').autodetectBuildCmd).toBe(true);
  });

  it('roulette-community opts in to autodetect', () => {
    expect(getSiteConfig('roulette-community').autodetectBuildCmd).toBe(true);
  });
});
