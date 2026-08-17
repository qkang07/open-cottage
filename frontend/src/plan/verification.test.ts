import { describe, expect, it } from 'vitest';
import {
  getVerificationRegistry,
  runCriteria,
  VerificationRegistry,
  verificationStateFromResults,
} from './verification';

describe('plan/verification', () => {
  it('rejects providers that are not registered instead of substituting checks', () => {
    const result = getVerificationRegistry().validate({
      id: 'unknown',
      providerId: 'shell.npmTest',
      description: '运行 npm test',
      required: true,
      config: { command: 'npm test' },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('未注册');
  });

  it('marks user acceptance as manual and unverified', async () => {
    const results = await runCriteria([
      {
        id: 'manual',
        providerId: 'user.acceptance',
        description: '用户检查页面交互',
        required: true,
        config: {},
      },
    ]);
    expect(results[0]?.status).toBe('manual');
    expect(verificationStateFromResults(results)).toBe('unverified');
  });

  it('never treats an empty check list as verified', () => {
    expect(verificationStateFromResults([])).toBe('unverified');
  });

  it('distinguishes structural browser evidence from machine verification', () => {
    expect(
      verificationStateFromResults([
        {
          id: 'exists',
          type: 'fileExists',
          pass: true,
          status: 'passed',
          runtime: 'browser',
          assurance: 'structural',
        },
      ]),
    ).toBe('partially_verified');
    expect(
      verificationStateFromResults([
        {
          id: 'worker',
          type: 'contentMatches',
          pass: true,
          status: 'passed',
          runtime: 'worker',
          assurance: 'structural',
        },
      ]),
    ).toBe('partially_verified');
  });

  it('only functional providers can produce verified state', () => {
    expect(
      verificationStateFromResults([
        {
          id: 'functional',
          type: 'contentMatches',
          pass: true,
          status: 'passed',
          runtime: 'remote',
          assurance: 'functional',
        },
      ]),
    ).toBe('verified');
  });

  it('rejects functional providers that are not explicitly trusted', () => {
    const registry = new VerificationRegistry();
    expect(() => registry.register({
      id: 'remote.functional',
      version: '1',
      label: 'remote',
      runtime: 'remote',
      assurance: 'functional',
      configSchema: { type: 'object' },
      capabilities: ['test'],
      isAvailable: () => true,
      validateConfig: () => ({ valid: true }),
      run: async () => ({ id: 'x', type: 'contentMatches', pass: true }),
    })).toThrow('trusted');
  });

  it('interprets legacy snapshots without version as v1', async () => {
    const result = await getVerificationRegistry().run(
      {
        id: 'hash',
        providerId: 'workspace.contentHash',
        description: '回读哈希',
        required: true,
        config: { path: 'frontend/src/a.ts' },
      },
      {
        capabilitySnapshot: [{
          providerId: 'workspace.contentHash',
          label: '旧内容哈希',
          runtime: 'browser',
          available: true,
          kinds: ['contentHash'],
        }],
      },
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('批准版本 1');
  });
});
