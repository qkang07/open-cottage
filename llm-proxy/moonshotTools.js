/**
 * Normalize OpenAI-style tool JSON Schemas for Moonshot MFJS.
 * @see https://github.com/MoonshotAI/walle/blob/main/docs/mfjs-spec.md
 */

const MFJS_TYPES = new Set([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'integer',
  'string',
]);

const STRIP_KEYS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'format',
  'default',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minContains',
  'maxContains',
  'pattern',
  'multipleOf',
  'uniqueItems',
  'prefixItems',
  'unevaluatedItems',
]);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const typeArrayToAnyOf = (types) =>
  types
    .filter((t) => MFJS_TYPES.has(t))
    .map((t) => ({ type: t }));

const ensureTypedProperty = (schema) => {
  if (!isPlainObject(schema)) return schema;
  if (
    'type' in schema ||
    'anyOf' in schema ||
    'oneOf' in schema ||
    'allOf' in schema ||
    'enum' in schema ||
    '$ref' in schema
  ) {
    return schema;
  }
  if ('properties' in schema || 'additionalProperties' in schema) {
    return { ...schema, type: 'object' };
  }
  if ('items' in schema) {
    return { ...schema, type: 'array' };
  }
  if (Object.keys(schema).length === 0) {
    return { type: 'object', additionalProperties: true };
  }
  return { ...schema, type: 'string' };
};

const isEmptySchemaObject = (schema) =>
  isPlainObject(schema) && Object.keys(schema).length === 0;

const sanitizeSchemaNode = (node) => {
  if (!isPlainObject(node)) return node;
  if (isEmptySchemaObject(node)) return node;

  if (Array.isArray(node.type)) {
    const anyOf = typeArrayToAnyOf(node.type);
    const { type: _type, ...rest } = node;
    const base = sanitizeSchemaNode(rest);
    if (!anyOf.length) return base;
    if (isEmptySchemaObject(base)) {
      return { anyOf };
    }
    return { anyOf: anyOf.map((branch) => ({ ...branch, ...base })) };
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIP_KEYS.has(key)) continue;

    if (key === 'properties' && isPlainObject(value)) {
      const properties = {};
      for (const [propKey, propSchema] of Object.entries(value)) {
        properties[propKey] = sanitizeSchemaNode(
          ensureTypedProperty(propSchema),
        );
      }
      out.properties = properties;
      continue;
    }

    if (key === 'items') {
      out.items = sanitizeSchemaNode(ensureTypedProperty(value));
      continue;
    }

    if (key === 'additionalProperties' && isPlainObject(value)) {
      out.additionalProperties = sanitizeSchemaNode(value);
      continue;
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = value.map((branch) => sanitizeSchemaNode(branch));
      continue;
    }

    if (key === '$defs' && isPlainObject(value)) {
      const defs = {};
      for (const [defKey, defSchema] of Object.entries(value)) {
        defs[defKey] = sanitizeSchemaNode(defSchema);
      }
      out.$defs = defs;
      continue;
    }

    out[key] = value;
  }

  if (isEmptySchemaObject(out)) return out;
  return ensureTypedProperty(out);
};

const sanitizeTool = (tool) => {
  if (!isPlainObject(tool) || tool.type !== 'function' || !isPlainObject(tool.function)) {
    return tool;
  }

  const fn = { ...tool.function };
  if (isPlainObject(fn.parameters)) {
    fn.parameters = sanitizeSchemaNode(fn.parameters);
  } else if (fn.parameters == null) {
    fn.parameters = { type: 'object', properties: {} };
  }

  return { ...tool, function: fn };
};

/**
 * @param {unknown} tools
 * @returns {unknown}
 */
function sanitizeToolsForMoonshot(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(sanitizeTool);
}

module.exports = { sanitizeToolsForMoonshot, sanitizeSchemaNode };
