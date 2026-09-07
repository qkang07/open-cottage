import { CottageDynamicTool, type CottageTool } from '@/agent/runtime/tool';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Moonshot 要求 $ref 以 #/$defs/ 开头，且不接受根级 $schema */
export const moonshotParametersFromZod = (schema: z.ZodTypeAny): JsonRecord => {
  const json = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'openApi3',
  }) as JsonRecord;

  delete json.$schema;
  return sanitizeMoonshotJsonSchema(json);
};

const sanitizeMoonshotJsonSchema = (node: unknown): JsonRecord => {
  if (!isRecord(node)) {
    return {};
  }

  const out: JsonRecord = { ...node };
  delete out.$schema;

  if (typeof out.$ref === 'string' && !out.$ref.startsWith('#/$defs/')) {
    delete out.$ref;
  }

  if (isRecord(out.$defs)) {
    const defs: JsonRecord = {};
    for (const [key, value] of Object.entries(out.$defs)) {
      defs[key] = sanitizeMoonshotJsonSchema(value);
    }
    out.$defs = defs;
  }

  if (isRecord(out.properties)) {
    const props: JsonRecord = {};
    for (const [key, value] of Object.entries(out.properties)) {
      props[key] = sanitizeMoonshotJsonSchema(value);
    }
    out.properties = props;
  }

  if (isRecord(out.items)) {
    out.items = sanitizeMoonshotJsonSchema(out.items);
  }

  if (isRecord(out.additionalProperties)) {
    out.additionalProperties = sanitizeMoonshotJsonSchema(
      out.additionalProperties,
    );
  }

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branch = out[key];
    if (Array.isArray(branch)) {
      out[key] = branch.map((item) => sanitizeMoonshotJsonSchema(item));
    }
  }

  // Moonshot 要求每个 schema 节点都定义 type；zod 的 union / any 会产出无 type 的节点。
  ensureMoonshotNodeType(out);

  return out;
};

const ALL_JSON_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
] as const;

const jsonTypeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number' || t === 'bigint') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string';
};

/** 收集 anyOf/oneOf 各分支声明的类型 */
const collectBranchTypes = (branches: unknown[]): string[] => {
  const types = new Set<string>();
  for (const branch of branches) {
    if (!isRecord(branch)) continue;
    const t = branch.type;
    if (typeof t === 'string') {
      types.add(t);
    } else if (Array.isArray(t)) {
      for (const x of t) if (typeof x === 'string') types.add(x);
    } else if (isRecord(branch.properties) || branch.additionalProperties !== undefined) {
      types.add('object');
    } else if (branch.items !== undefined) {
      types.add('array');
    } else if (Array.isArray(branch.enum)) {
      for (const v of branch.enum) types.add(jsonTypeOf(v));
    }
  }
  return [...types];
};

const isScalarBranch = (branch: unknown): boolean =>
  isRecord(branch) &&
  !isRecord(branch.properties) &&
  branch.additionalProperties === undefined &&
  branch.items === undefined &&
  (typeof branch.type === 'string' || Array.isArray(branch.type));

const setType = (out: JsonRecord, types: string[]): void => {
  if (!types.length) return;
  out.type = types.length === 1 ? types[0] : types;
};

const ensureMoonshotNodeType = (out: JsonRecord): void => {
  // openApi3 用 nullable:true 表示 null；Moonshot 接受 JSON Schema type 数组，
  // 折叠 union 时必须把 nullable 显式还原成 null 类型。
  const nullable = out.nullable === true;
  if (nullable) delete out.nullable;
  if (out.type !== undefined) {
    if (nullable) {
      const declared = Array.isArray(out.type) ? out.type : [out.type];
      setType(
        out,
        [...new Set([...declared.filter((type): type is string => typeof type === 'string'), 'null'])],
      );
    }
    return;
  }
  if (typeof out.$ref === 'string') return;

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branch = out[key];
    if (Array.isArray(branch) && branch.length > 0) {
      // 纯标量联合（如 string|number|boolean|null）折叠为 type 数组，去掉 anyOf
      if (branch.every(isScalarBranch)) {
        const types = collectBranchTypes(branch);
        if (nullable) types.push('null');
        if (types.length) {
          setType(out, [...new Set(types)]);
          delete out[key];
        }
        return;
      }
      // 含对象/数组等复合分支：Moonshot 要求 type 只能定义在各 anyOf/oneOf
      // 子项里，父级不得带 type（否则报 "type should be defined in anyOf
      // items instead of the parent schema"）。子项已在递归 sanitize 时各自补齐 type。
      if (nullable && !branch.some((item) => isRecord(item) && item.type === 'null')) {
        branch.push({ type: 'null' });
      }
      return;
    }
  }

  if (Array.isArray(out.allOf) && out.allOf.length > 0) {
    setType(out, nullable ? ['object', 'null'] : ['object']);
    return;
  }
  if (Array.isArray(out.enum) && out.enum.length > 0) {
    const types = out.enum.map(jsonTypeOf);
    if (nullable) types.push('null');
    setType(out, [...new Set(types)]);
    return;
  }
  if (isRecord(out.properties) || out.additionalProperties !== undefined) {
    setType(out, nullable ? ['object', 'null'] : ['object']);
    return;
  }
  if (out.items !== undefined) {
    setType(out, nullable ? ['array', 'null'] : ['array']);
    return;
  }

  // 空 schema（如 z.any()）：放行任意类型
  out.type = [...ALL_JSON_TYPES];
};

const isZodSchema = (schema: unknown): schema is z.ZodTypeAny =>
  typeof schema === 'object' &&
  schema !== null &&
  'safeParse' in schema &&
  typeof (schema as z.ZodTypeAny).safeParse === 'function';

/** 将工具列表转为 Moonshot 可接受的 JSON Schema 参数（无非法 $ref） */
export const adaptToolsForMoonshot = (
  tools: CottageTool[],
): CottageTool[] =>
  tools.map((t) => {
    const rawSchema = (t as { schema?: unknown }).schema;
    if (!isZodSchema(rawSchema)) {
      return t;
    }

    const parameters = moonshotParametersFromZod(rawSchema);

    return new CottageDynamicTool({
      name: t.name,
      description: t.description,
      schema: parameters,
      func: async (input, config) => t.invoke(input, config),
    });
  });
