/** Native YAML schema for the canonical local profile; core still owns semantic policy. */
export const PROFILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['sandbox'],
  properties: {
    sandbox: {
      type: 'object',
      required: ['namespace', 'pipelines'],
      properties: {
        namespace: {
          type: 'string',
          pattern: '^[a-z][a-z0-9_]{0,63}$',
          description: 'Local sandbox namespace. Lowercase letters, digits and underscores.',
        },
        pipelines: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 },
          description: 'Case-sensitive pipeline names or globs resolved by LHP.',
        },
      },
    },
  },
};
