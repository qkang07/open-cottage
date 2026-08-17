import { describe, expect, it } from 'vitest';
import { CAPABILITY_PACK_SCHEMA } from './types';
import { validateCapabilityPackManifest } from './validate';

describe('validateCapabilityPackManifest', () => {
  it('accepts minimal valid manifest', () => {
    const manifest = validateCapabilityPackManifest({
      schema: CAPABILITY_PACK_SCHEMA,
      id: 'demo.pack',
      name: 'Demo',
      version: '1.0.0',
    });
    expect(manifest.id).toBe('demo.pack');
  });

  it('rejects invalid id', () => {
    expect(() =>
      validateCapabilityPackManifest({
        schema: CAPABILITY_PACK_SCHEMA,
        id: 'Bad ID',
        name: 'Demo',
        version: '1.0.0',
      }),
    ).toThrow();
  });
});
