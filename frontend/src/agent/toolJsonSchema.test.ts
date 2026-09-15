import { describe, expect, it } from 'vitest';
import { toolWritePresentationInputSchema } from './officeWriteSchema';
import { zodToToolJsonSchema } from './toolJsonSchema';

describe('zodToToolJsonSchema', () => {
  it('uses numeric exclusiveMinimum for positive numbers', () => {
    const schema = zodToToolJsonSchema(toolWritePresentationInputSchema, {
      $refStrategy: 'none',
    });
    const content = (
      schema.properties as Record<string, Record<string, unknown>>
    ).content;
    const objectContent = (content.anyOf as Array<Record<string, unknown>>)[1];
    const slides = (
      objectContent.properties as Record<string, Record<string, unknown>>
    ).slides;
    const elements = (
      slides.items as Record<string, Record<string, unknown>>
    ).properties;
    const columnWidths = (
      (elements.elements as Record<string, Record<string, unknown>>).items as Record<
        string,
        Record<string, unknown>
      >
    ).properties;
    const widthItem = (
      (columnWidths.columnWidths as Record<string, Record<string, unknown>>).items as Record<
        string,
        unknown
      >
    );

    expect(widthItem.exclusiveMinimum).toBe(0);
    expect(widthItem.minimum).toBeUndefined();
    expect(schema.$schema).toBeUndefined();
  });
});
