import { describe, expect, it } from 'vitest';
import { ArtifactStore, ARTIFACT_INLINE_MAX_CHARS } from './artifactStore';
import type { Artifact } from './types';

describe('orchestrator/artifactStore', () => {
  it('stores and retrieves artifacts', () => {
    const store = new ArtifactStore({ orchestrationId: 'o1' });
    const artifact: Artifact = {
      id: 'a1',
      type: 'text',
      name: 'note.txt',
      content: 'hello',
      producerStepId: 's1',
      createdAt: 1,
    };
    store.importAll([artifact]);
    expect(store.get('a1')).toEqual(artifact);
    expect(store.getByStep('s1')).toEqual([artifact]);
  });

  it('persists large content to workspace', async () => {
    const persisted: Array<{ id: string; name: string; content: string }> = [];
    const store = new ArtifactStore({
      orchestrationId: 'o1',
      persistLargeContent: async (id, name, content) => {
        persisted.push({ id, name, content });
        return `artifacts/${id}`;
      },
    });

    const bigContent = 'x'.repeat(ARTIFACT_INLINE_MAX_CHARS + 1);
    const artifact = await store.add({
      id: 'a1',
      type: 'text',
      name: 'big.txt',
      content: bigContent,
      producerStepId: 's1',
    });

    expect(artifact.filePath).toBe('artifacts/a1');
    expect(artifact.content).toBe(bigContent.slice(0, ARTIFACT_INLINE_MAX_CHARS));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toBe(bigContent);
  });

  it('loads full content from file path', async () => {
    const fullContent = 'full content';
    const store = new ArtifactStore({
      orchestrationId: 'o1',
      loadLargeContent: async () => fullContent,
    });
    store.importAll([
      {
        id: 'a1',
        type: 'text',
        name: 'file.txt',
        filePath: 'path/to/file',
        content: 'summary',
        producerStepId: 's1',
        createdAt: 1,
      },
    ]);

    const loaded = await store.loadContent('a1');
    expect(loaded).toBe(fullContent);
  });

  it('returns existing artifact on duplicate add', async () => {
    const store = new ArtifactStore({ orchestrationId: 'o1' });
    const first = await store.add({
      id: 'a1',
      type: 'text',
      name: 'x.txt',
      content: 'first',
      producerStepId: 's1',
    });
    const second = await store.add({
      id: 'a1',
      type: 'text',
      name: 'x.txt',
      content: 'second',
      producerStepId: 's1',
    });
    expect(first).toBe(second);
    expect(store.get('a1')?.content).toBe('first');
  });
});
