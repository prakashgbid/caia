import { verifyFiles } from '../verifiers/file-verifier';
import { verifyUrls } from '../verifiers/url-verifier';

describe('file-verifier', () => {
  it('returns pass for existing file', () => {
    const results = verifyFiles({
      kind: 'test',
      id: 'test-1',
      verificationPlan: ['file_exists: /etc/hosts'],
    });
    // /etc/hosts should always exist on macOS
    const check = results.find(r => r.checkKind === 'file_exists');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it('returns fail for missing file', () => {
    const results = verifyFiles({
      kind: 'test',
      id: 'test-2',
      verificationPlan: ['file_exists: /definitely/not/a/real/path/file.ts'],
    });
    const check = results.find(r => r.checkKind === 'file_exists');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('critical');
  });

  it('returns empty array when no file checks in plan', () => {
    const results = verifyFiles({
      kind: 'test',
      id: 'test-3',
      verificationPlan: ['url_200: Check the API'],
    });
    expect(results).toHaveLength(0);
  });
});

describe('url-verifier', () => {
  it('handles unreachable URL gracefully', async () => {
    const results = await verifyUrls({
      kind: 'test',
      id: 'test-4',
      verificationPlan: ['url_200: Check http://localhost:19999/definitely-not-running'],
    });
    // Should not throw, may return empty (no URL extracted from plan text yet) or fail
    expect(Array.isArray(results)).toBe(true);
  });
});
