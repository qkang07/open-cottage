import { CAPABILITY_PACK_SCHEMA, type CapabilityPackManifest } from './types';

const ID_RE = /^[a-z][a-z0-9._-]{1,63}$/;

export const validateCapabilityPackManifest = (
  raw: unknown,
): CapabilityPackManifest => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('能力包 manifest 必须是 JSON 对象');
  }
  const m = raw as Record<string, unknown>;
  if (m.schema !== CAPABILITY_PACK_SCHEMA) {
    throw new Error(`schema 须为 ${CAPABILITY_PACK_SCHEMA}`);
  }
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    throw new Error('id 须为小写字母开头的 2–64 字符标识符');
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    throw new Error('name 不能为空');
  }
  if (typeof m.version !== 'string' || !m.version.trim()) {
    throw new Error('version 不能为空');
  }

  const manifest: CapabilityPackManifest = {
    schema: CAPABILITY_PACK_SCHEMA,
    id: m.id,
    name: m.name.trim(),
    version: m.version.trim(),
    description: typeof m.description === 'string' ? m.description : undefined,
    promptOverlay:
      typeof m.promptOverlay === 'string' ? m.promptOverlay : undefined,
    requiresApproval:
      typeof m.requiresApproval === 'boolean' ? m.requiresApproval : undefined,
  };

  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) {
      throw new Error('capabilities 须为数组');
    }
    manifest.capabilities = m.capabilities as CapabilityPackManifest['capabilities'];
  }

  if (m.skills !== undefined) {
    if (!Array.isArray(m.skills)) throw new Error('skills 须为数组');
    manifest.skills = m.skills.map((s, i) => {
      if (!s || typeof s !== 'object') {
        throw new Error(`skills[${i}] 无效`);
      }
      const item = s as Record<string, unknown>;
      if (typeof item.file !== 'string' || !item.file.trim()) {
        throw new Error(`skills[${i}].file 不能为空`);
      }
      if (typeof item.content !== 'string') {
        throw new Error(`skills[${i}].content 须为字符串`);
      }
      return { file: item.file.trim(), content: item.content };
    });
  }

  if (m.mcpServers !== undefined) {
    if (!Array.isArray(m.mcpServers)) throw new Error('mcpServers 须为数组');
    manifest.mcpServers = m.mcpServers as CapabilityPackManifest['mcpServers'];
  }

  if (m.suggestedTools !== undefined) {
    if (!Array.isArray(m.suggestedTools)) {
      throw new Error('suggestedTools 须为字符串数组');
    }
    manifest.suggestedTools = m.suggestedTools.filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    );
  }

  return manifest;
};
