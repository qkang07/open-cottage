import type { z } from 'zod';

export interface CottageToolConfig {
  signal?: AbortSignal;
  configurable?: Record<string, unknown>;
}

export type CottageToolSchema =
  | z.ZodTypeAny
  | Record<string, unknown>;

export type CottageToolInput<TSchema extends CottageToolSchema> =
  TSchema extends z.ZodTypeAny ? z.output<TSchema> : unknown;

export interface CottageTool {
  name: string;
  description: string;
  schema: CottageToolSchema;
  invoke(input: unknown, config?: CottageToolConfig): Promise<unknown>;
}

type CottageToolFunction<TInput = unknown> = (
  input: TInput,
  config?: CottageToolConfig,
) => unknown | Promise<unknown>;

export interface CottageToolFields<
  TSchema extends CottageToolSchema = CottageToolSchema,
> {
  name: string;
  description: string;
  schema: TSchema;
}

const parseToolInput = <TSchema extends CottageToolSchema>(
  schema: TSchema,
  input: unknown,
): CottageToolInput<TSchema> => {
  if (
    schema &&
    typeof schema === 'object' &&
    'safeParse' in schema &&
    typeof schema.safeParse === 'function'
  ) {
    const result = schema.safeParse(input);
    if (!result.success) throw result.error;
    return result.data as CottageToolInput<TSchema>;
  }
  return input as CottageToolInput<TSchema>;
};

export class CottageDynamicTool<
  TSchema extends CottageToolSchema = CottageToolSchema,
> implements CottageTool {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  private readonly func: CottageToolFunction<CottageToolInput<TSchema>>;

  constructor(
    fields: CottageToolFields<TSchema> & {
      func: CottageToolFunction<CottageToolInput<TSchema>>;
    },
  ) {
    this.name = fields.name;
    this.description = fields.description;
    this.schema = fields.schema;
    this.func = fields.func;
  }

  async invoke(input: unknown, config?: CottageToolConfig): Promise<unknown> {
    return this.func(parseToolInput(this.schema, input), config);
  }
}

export abstract class CottageStructuredTool implements CottageTool {
  abstract name: string;
  abstract description: string;
  abstract schema: CottageToolSchema;

  protected abstract call(
    input: any,
    config?: CottageToolConfig,
  ): Promise<unknown>;

  async invoke(input: unknown, config?: CottageToolConfig): Promise<unknown> {
    return this.call(parseToolInput(this.schema, input), config);
  }
}

export const cottageTool = <TSchema extends CottageToolSchema>(
  func: CottageToolFunction<CottageToolInput<TSchema>>,
  fields: CottageToolFields<TSchema>,
): CottageTool => new CottageDynamicTool({ ...fields, func });
