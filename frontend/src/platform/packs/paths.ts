export const COTTAGE_PACKS_DIR = 'packs';

export const packRootPath = (packId: string) =>
  `${COTTAGE_PACKS_DIR}/${packId}`;

export const packManifestPath = (packId: string) =>
  `${packRootPath(packId)}/manifest.json`;

export const packPromptPath = (packId: string) =>
  `${packRootPath(packId)}/prompt.md`;

export const packSkillsDir = (packId: string) =>
  `${packRootPath(packId)}/skills`;

export const packSkillPath = (packId: string, file: string) =>
  `${packSkillsDir(packId)}/${file}`;
