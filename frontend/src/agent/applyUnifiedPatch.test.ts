import { describe, expect, it } from 'vitest';
import {
  applyHunksToContent,
  applyUnifiedPatch,
  parseUnifiedPatch,
} from './applyUnifiedPatch';

describe('applyUnifiedPatch', () => {
  it('parses and applies a single-file hunk', async () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    const patch = `--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,4 @@
 a
 b
-c
+C
 d
`;
    const files = parseUnifiedPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('foo.ts');
    const after = applyHunksToContent(before, files[0].hunks);
    expect(after).toBe(['a', 'b', 'C', 'd'].join('\n'));

    const results = await applyUnifiedPatch(patch, {
      readFile: async () => before,
    });
    expect(results[0].after).toBe(['a', 'b', 'C', 'd'].join('\n'));
    expect(results[0].created).toBe(false);
  });

  it('creates a new file from /dev/null', async () => {
    const patch = `--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+hello
+world
`;
    const results = await applyUnifiedPatch(patch, {
      readFile: async () => null,
    });
    expect(results[0].created).toBe(true);
    expect(results[0].after).toBe('hello\nworld');
  });

  it('deletes a file to /dev/null', async () => {
    const patch = `--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;
    const results = await applyUnifiedPatch(patch, {
      readFile: async () => 'one\ntwo',
    });
    expect(results[0].deleted).toBe(true);
    expect(results[0].after).toBe('');
  });

  it('applies bare hunks with defaultPath', async () => {
    const patch = `@@ -1,2 +1,2 @@
 line1
-old
+new
`;
    const before = 'line1\nold';
    const results = await applyUnifiedPatch(patch, {
      readFile: async () => before,
      defaultPath: 'x.ts',
    });
    expect(results[0].path).toBe('x.ts');
    expect(results[0].after).toBe('line1\nnew');
  });
});
