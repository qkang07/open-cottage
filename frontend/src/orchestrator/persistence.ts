import { workspace } from '../workspace/FileSystemWorkspace';
import type { Artifact, OrchestrationState, SerializedOrchestration } from './types';

const ORCHESTRATIONS_DIR = 'orchestrations';

function statePath(orchestrationId: string): string {
  return `${ORCHESTRATIONS_DIR}/${orchestrationId}/state.json`;
}

function artifactsPath(orchestrationId: string): string {
  return `${ORCHESTRATIONS_DIR}/${orchestrationId}/artifacts.json`;
}

function largeArtifactPath(
  orchestrationId: string,
  artifactId: string,
  name: string,
): string {
  const safeName = name.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(0, 64);
  return `${ORCHESTRATIONS_DIR}/${orchestrationId}/artifacts/${artifactId}_${safeName}`;
}

export async function saveOrchestration(
  orchestrationId: string,
  state: OrchestrationState,
  artifacts: Artifact[],
): Promise<void> {
  await workspace.writeCottagePath(statePath(orchestrationId), state);
  await workspace.writeCottagePath(artifactsPath(orchestrationId), artifacts);
}

export async function loadOrchestration(
  orchestrationId: string,
): Promise<SerializedOrchestration | null> {
  const state = await workspace.readCottagePath<OrchestrationState>(
    statePath(orchestrationId),
  );
  if (!state) return null;

  const artifacts =
    (await workspace.readCottagePath<Artifact[]>(artifactsPath(orchestrationId))) ??
    [];
  return { state, artifacts };
}

export async function listActiveOrchestrations(): Promise<OrchestrationState[]> {
  if (!workspace.isOpen) return [];

  let cottageDir: FileSystemDirectoryHandle;
  try {
    cottageDir = await workspace.ensureCottageDir();
  } catch {
    return [];
  }

  let orchestrationsDir: FileSystemDirectoryHandle;
  try {
    orchestrationsDir = await cottageDir.getDirectoryHandle(ORCHESTRATIONS_DIR);
  } catch {
    return [];
  }

  const states: OrchestrationState[] = [];
  for await (const [name, handle] of orchestrationsDir.entries()) {
    if (handle.kind !== 'directory') continue;
    const serialized = await loadOrchestration(name).catch(() => null);
    if (serialized?.state) {
      states.push(serialized.state);
    }
  }
  return states.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function persistLargeArtifactContent(
  orchestrationId: string,
  artifactId: string,
  name: string,
  content: string,
): Promise<string> {
  const path = largeArtifactPath(orchestrationId, artifactId, name);
  await workspace.writeCottageText(path, content);
  return path;
}

export async function loadLargeArtifactContent(
  filePath: string,
): Promise<string | null> {
  return workspace.readCottageText(filePath);
}

export async function deleteOrchestration(
  orchestrationId: string,
): Promise<void> {
  const path = `${ORCHESTRATIONS_DIR}/${orchestrationId}`;
  await workspace.deleteEntry(path);
}
