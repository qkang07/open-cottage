/**
 * MCP Tool → CottageStructuredTool 适配器
 *
 * 将 MCP 工具的 JSON Schema 转换为 Cottage 兼容的工具接口。
 */

import { z } from 'zod';
import { CottageStructuredTool } from '@/agent/runtime/tool';
import type { McpToolDefinition, McpToolResult } from './transport';

/**
 * MCP 工具名格式：mcp__<serverId>__<toolName>
 */
export const mcpToolName = (serverId: string, toolName: string): string =>
  `mcp__${serverId}__${toolName}`;

/**
 * 从 MCP 工具名解析 serverId 和 toolName
 */
export const parseMcpToolName = (
  name: string,
): { serverId: string; toolName: string } | null => {
  const match = name.match(/^mcp__([^_]+)__(.+)$/);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
};

/**
 * 将 JSON Schema 转换为 Zod schema（简化版本，支持常见类型）
 */
const jsonSchemaToZod = (schema: Record<string, unknown>): z.ZodType => {
  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) ?? [];

  if (type === 'object' && properties) {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, prop] of Object.entries(properties)) {
      let fieldSchema = convertProperty(prop);
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[key] = fieldSchema;
    }
    return z.object(shape);
  }

  if (type === 'string') return z.string();
  if (type === 'number' || type === 'integer') return z.number();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') return z.array(z.unknown());

  // 默认接受任意 JSON 对象
  return z.record(z.unknown());
};

const convertProperty = (prop: Record<string, unknown>): z.ZodType => {
  const type = prop.type as string | undefined;
  const desc = prop.description as string | undefined;

  let schema: z.ZodType;

  switch (type) {
    case 'string': {
      let s = z.string();
      if (prop.enum) {
        schema = z.enum(prop.enum as [string, ...string[]]);
      } else {
        schema = s;
      }
      break;
    }
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(
        prop.items ? convertProperty(prop.items as Record<string, unknown>) : z.unknown(),
      );
      break;
    case 'object':
      schema = jsonSchemaToZod(prop);
      break;
    default:
      schema = z.unknown();
  }

  if (desc) {
    schema = schema.describe(desc);
  }

  return schema;
};

/**
 * 将 MCP 工具定义转为 CottageStructuredTool
 */
export const mcpToolToCottage = (
  serverId: string,
  mcpTool: McpToolDefinition,
  invokeFn: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>,
): CottageStructuredTool => {
  const name = mcpToolName(serverId, mcpTool.name);
  const description = mcpTool.description ?? `MCP tool: ${mcpTool.name}`;
  const inputSchema = jsonSchemaToZod(mcpTool.inputSchema ?? {});

  return new McpCottageTool({
    name,
    description,
    schema: inputSchema as z.ZodObject<z.ZodRawShape>,
    mcpToolName: mcpTool.name,
    invokeFn,
  });
};

interface McpCottageToolOptions {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  mcpToolName: string;
  invokeFn: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
}

class McpCottageTool extends CottageStructuredTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  private mcpToolNameInternal: string;
  private invokeFn: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;

  constructor(options: McpCottageToolOptions) {
    super();
    this.name = options.name;
    this.description = options.description;
    this.schema = options.schema;
    this.mcpToolNameInternal = options.mcpToolName;
    this.invokeFn = options.invokeFn;
  }

  async call(input: z.infer<typeof this.schema>): Promise<string> {
    try {
      const result = await this.invokeFn(
        this.mcpToolNameInternal,
        input as Record<string, unknown>,
      );

      // 将结果转为文本
      const textParts = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);

      if (result.isError) {
        return `[MCP Error] ${textParts.join('\n') || 'Unknown error'}`;
      }

      return textParts.join('\n') || JSON.stringify(result.content);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `[MCP Error] ${msg}`;
    }
  }
}
