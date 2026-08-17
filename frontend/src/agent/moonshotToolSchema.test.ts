import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { moonshotParametersFromZod } from './moonshotToolSchema';
import { toolWriteSpreadsheetInputSchema } from './spreadsheetWriteSchema';
import {
  toolBatchGenerateOfficeDocsInputSchema,
  toolWritePresentationInputSchema,
} from './officeWriteSchema';

const collectRefs = (node: unknown, refs: string[] = []): string[] => {
  if (node === null || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return refs;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.$ref === 'string') refs.push(record.$ref);
  for (const value of Object.values(record)) collectRefs(value, refs);
  return refs;
};

const SCHEMA_NODE_KEYS = new Set([
  'properties',
  'items',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'allOf',
  'enum',
]);

const isSchemaNode = (record: Record<string, unknown>): boolean =>
  [...SCHEMA_NODE_KEYS].some((k) => record[k] !== undefined) ||
  typeof record.type === 'string' ||
  Array.isArray(record.type);

/** Moonshot 要求每个 schema 节点都定义 type；收集缺失 type 的节点路径 */
const findNodesMissingType = (
  node: unknown,
  path = '$',
  missing: string[] = [],
): string[] => {
  if (node === null || typeof node !== 'object') return missing;
  if (Array.isArray(node)) {
    node.forEach((item, i) => findNodesMissingType(item, `${path}[${i}]`, missing));
    return missing;
  }
  const record = node as Record<string, unknown>;
  // anyOf/oneOf 节点的 type 定义在各子项中，父级不应带 type，故豁免
  const isUnionNode =
    Array.isArray(record.anyOf) || Array.isArray(record.oneOf);
  if (
    typeof record.$ref !== 'string' &&
    isSchemaNode(record) &&
    record.type === undefined &&
    !isUnionNode
  ) {
    missing.push(path);
  }
  for (const [key, value] of Object.entries(record)) {
    findNodesMissingType(value, `${path}.${key}`, missing);
  }
  return missing;
};

describe('moonshotParametersFromZod', () => {
  it('writeSpreadsheet schema has no illegal $ref or $schema', () => {
    const params = moonshotParametersFromZod(toolWriteSpreadsheetInputSchema);
    expect(params.$schema).toBeUndefined();
    const refs = collectRefs(params);
    for (const ref of refs) {
      expect(ref.startsWith('#/$defs/')).toBe(true);
    }
    expect(
      refs.some((r) => r.includes('properties/content/properties/slide')),
    ).toBe(false);
  });

  it('inlines duplicate object shapes without cross-property $ref', () => {
    const schema = z.object({
      a: z.object({ x: z.string().optional() }),
      b: z.object({ x: z.string().optional() }),
    });
    const params = moonshotParametersFromZod(schema);
    const refs = collectRefs(params);
    expect(refs.length).toBe(0);
  });

  it('defines type on every schema node (office template variables record)', () => {
    const params = moonshotParametersFromZod(
      toolBatchGenerateOfficeDocsInputSchema,
    );
    expect(findNodesMissingType(params)).toEqual([]);
  });

  it('keeps anyOf union type on branches, not parent (writePresentation content)', () => {
    const params = moonshotParametersFromZod(
      toolWritePresentationInputSchema,
    );
    const content = (
      params.properties as Record<string, Record<string, unknown>>
    ).content;
    expect(Array.isArray(content.anyOf)).toBe(true);
    // Moonshot 要求 anyOf 节点父级不带 type
    expect(content.type).toBeUndefined();
    // 各分支必须自带 type
    for (const branch of content.anyOf as Array<Record<string, unknown>>) {
      expect(branch.type).toBeDefined();
    }
    // 其余非 union 节点仍需有 type
    expect(findNodesMissingType(params)).toEqual([]);
  });

  it('collapses scalar unions into a type array and drops anyOf', () => {
    const schema = z.object({
      v: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    });
    const params = moonshotParametersFromZod(schema);
    const v = (params.properties as Record<string, Record<string, unknown>>).v;
    expect(v.anyOf).toBeUndefined();
    expect(Array.isArray(v.type)).toBe(true);
    expect(new Set(v.type as string[])).toEqual(
      new Set(['string', 'number', 'boolean', 'null']),
    );
  });

  it('falls back to permissive type for z.any() nodes', () => {
    const schema = z.object({ cells: z.array(z.array(z.any())) });
    const params = moonshotParametersFromZod(schema);
    expect(findNodesMissingType(params)).toEqual([]);
  });
});
