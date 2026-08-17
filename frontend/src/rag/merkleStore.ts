import type { MerkleSnapshot } from './merkle';
import type { IndexWorkspace } from './indexWorkspace';
import { workspace } from '../workspace/FileSystemWorkspace';

const MERKLE_FILE = '.cottage/index/merkle.json';

export async function loadMerkleWs(
  ws: IndexWorkspace,
): Promise<MerkleSnapshot | null> {
  const content = await ws.readFile(MERKLE_FILE);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as MerkleSnapshot;
    if (parsed.version !== 1 || typeof parsed.root !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMerkleWs(
  ws: IndexWorkspace,
  snapshot: MerkleSnapshot,
): Promise<void> {
  await ws.writeFile(MERKLE_FILE, JSON.stringify(snapshot));
}

export async function loadMerkle(): Promise<MerkleSnapshot | null> {
  try {
    const { content } = await workspace.readFile(MERKLE_FILE);
    if (!content) return null;
    const parsed = JSON.parse(content) as MerkleSnapshot;
    if (parsed.version !== 1 || typeof parsed.root !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMerkle(snapshot: MerkleSnapshot): Promise<void> {
  await workspace.writeFile(MERKLE_FILE, JSON.stringify(snapshot));
}
