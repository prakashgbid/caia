import { describe, it, expect } from 'vitest';
import {
  SYSTEMD_UNIT_REGEX,
  SUDOERS_NAME_REGEX,
  CRON_NAME_REGEX,
  VETTED_PACKAGES,
  ALLOWED_SERVICES,
  FORBIDDEN_PATHS,
  ALLOWED_OPERATIONS,
  OPERATION_DESCRIPTIONS,
  DEFAULT_CONFIG,
} from './index';

describe('orchestrator-elevate constants', () => {
  describe('SYSTEMD_UNIT_REGEX', () => {
    const validUnits = [
      'actions.runner.caia-1.service',
      'actions.runner.caia-some-name.service',
      'caia-service.service',
      'stolution-worker.service',
      'cowork-agent.service',
    ];

    const invalidUnits = [
      'app.service',
      'caia.service',
      'systemd-user.service',
      'test@.service',
      'actions.runner.service',
      'caia-Service.service', // uppercase
      'caia_service.service', // underscore instead of hyphen
    ];

    validUnits.forEach((unit) => {
      it(`matches valid unit: ${unit}`, () => {
        expect(SYSTEMD_UNIT_REGEX.test(unit)).toBe(true);
      });
    });

    invalidUnits.forEach((unit) => {
      it(`rejects invalid unit: ${unit}`, () => {
        expect(SYSTEMD_UNIT_REGEX.test(unit)).toBe(false);
      });
    });
  });

  describe('SUDOERS_NAME_REGEX and CRON_NAME_REGEX', () => {
    const validNames = [
      'runner-orchestrator',
      'cron-orchestrator',
      'test-orchestrator',
      'a-orchestrator',
      'test-123-orchestrator',
    ];

    const invalidNames = [
      'orchestrator', // missing prefix
      'Runner-orchestrator', // uppercase
      'test_orchestrator', // underscore
      'test-Orchestrator', // uppercase suffix
      'test-orchest', // wrong suffix
      '1test-orchestrator', // starts with number
      '-test-orchestrator', // starts with hyphen
      'test--orchestrator', // double hyphen
    ];

    validNames.forEach((name) => {
      it(`sudoers: matches valid name: ${name}`, () => {
        expect(SUDOERS_NAME_REGEX.test(name)).toBe(true);
      });
    });

    validNames.forEach((name) => {
      it(`cron: matches valid name: ${name}`, () => {
        expect(CRON_NAME_REGEX.test(name)).toBe(true);
      });
    });

    invalidNames.forEach((name) => {
      it(`sudoers: rejects invalid name: ${name}`, () => {
        expect(SUDOERS_NAME_REGEX.test(name)).toBe(false);
      });
    });

    invalidNames.forEach((name) => {
      it(`cron: rejects invalid name: ${name}`, () => {
        expect(CRON_NAME_REGEX.test(name)).toBe(false);
      });
    });
  });

  describe('VETTED_PACKAGES', () => {
    it('contains security-safe packages', () => {
      expect(VETTED_PACKAGES).toContain('curl');
      expect(VETTED_PACKAGES).toContain('git');
      expect(VETTED_PACKAGES).toContain('jq');
      expect(VETTED_PACKAGES).toContain('nginx');
    });

    it('does not contain dangerous packages', () => {
      expect(VETTED_PACKAGES).not.toContain('sudo');
      expect(VETTED_PACKAGES).not.toContain('openssh-server');
      expect(VETTED_PACKAGES).not.toContain('malicious');
    });

    it('has at least 15 packages', () => {
      expect(VETTED_PACKAGES.length).toBeGreaterThanOrEqual(15);
    });
  });

  describe('ALLOWED_SERVICES', () => {
    it('contains expected services', () => {
      expect(ALLOWED_SERVICES).toContain('nginx');
      expect(ALLOWED_SERVICES).toContain('syncthing');
    });

    it('does not contain dangerous services', () => {
      expect(ALLOWED_SERVICES).not.toContain('sshd');
      expect(ALLOWED_SERVICES).not.toContain('sudo');
    });
  });

  describe('FORBIDDEN_PATHS', () => {
    const critical_paths = [
      '/etc/sudoers',
      '/etc/passwd',
      '/etc/shadow',
      '/etc/group',
      '/root/',
      '/usr/local/bin/orchestrator-exec',
    ];

    critical_paths.forEach((path) => {
      it(`forbids: ${path}`, () => {
        expect(FORBIDDEN_PATHS).toContain(path);
      });
    });
  });

  describe('ALLOWED_OPERATIONS', () => {
    it('contains expected operations', () => {
      expect(ALLOWED_OPERATIONS).toContain('install-systemd-unit');
      expect(ALLOWED_OPERATIONS).toContain('systemctl-action');
      expect(ALLOWED_OPERATIONS).toContain('install-sudoers-entry');
      expect(ALLOWED_OPERATIONS).toContain('apt-install-package');
      expect(ALLOWED_OPERATIONS).toContain('service-reload');
      expect(ALLOWED_OPERATIONS).toContain('cron-install');
    });

    it('has descriptions for all operations', () => {
      ALLOWED_OPERATIONS.forEach((op) => {
        expect(OPERATION_DESCRIPTIONS[op]).toBeDefined();
        expect(OPERATION_DESCRIPTIONS[op].length).toBeGreaterThan(0);
      });
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected paths', () => {
      expect(DEFAULT_CONFIG.wrapperPath).toBe('/usr/local/bin/orchestrator-exec');
      expect(DEFAULT_CONFIG.sudoersPath).toBe('/etc/sudoers.d/orchestrator');
      expect(DEFAULT_CONFIG.logPath).toBe('/var/log/orchestrator-exec.log');
      expect(DEFAULT_CONFIG.vaultAppRolePath).toBe('auth/approle/role/orchestrator');
      expect(DEFAULT_CONFIG.credentialsPath).toBe('/home/s903/.orchestrator-vault-creds');
    });
  });
});
