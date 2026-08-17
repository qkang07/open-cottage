import { describe, expect, it } from 'vitest';
import { isBinaryPath } from './historyService';

describe('isBinaryPath', () => {
  it('identifies common binary extensions', () => {
    expect(isBinaryPath('image.png')).toBe(true);
    expect(isBinaryPath('archive.zip')).toBe(true);
    expect(isBinaryPath('document.docx')).toBe(true);
    expect(isBinaryPath('font.woff2')).toBe(true);
    expect(isBinaryPath('binary.exe')).toBe(true);
  });

  it('identifies text paths', () => {
    expect(isBinaryPath('src/index.ts')).toBe(false);
    expect(isBinaryPath('README.md')).toBe(false);
    expect(isBinaryPath('config.json')).toBe(false);
    expect(isBinaryPath('logo.svg')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBinaryPath('image.PNG')).toBe(true);
    expect(isBinaryPath('src/index.TS')).toBe(false);
  });
});
