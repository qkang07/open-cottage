import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

type JsonRecord = Record<string, unknown>;

/**
 * 生成发送给模型工具调用的标准 JSON Schema。
 *
 * OpenAPI 3 把 z.number().positive() 编译成
 * `exclusiveMinimum: true` + `minimum: 0`，而 xAI 等 JSON Schema
 * 校验器要求 Draft 7 形式的数值 `exclusiveMinimum: 0`。
 */
export const zodToToolJsonSchema = (
  schema: z.ZodTypeAny,
  options?: { $refStrategy?: 'root' | 'relative' | 'none' },
): JsonRecord => {
  const json = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: options?.$refStrategy ?? 'root',
  }) as JsonRecord;

  // 工具参数只需要 schema 本身；部分 provider 不接受根级元数据字段。
  delete json.$schema;
  return json;
};
