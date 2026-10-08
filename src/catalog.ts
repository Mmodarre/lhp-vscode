import type {
  ActionDefinition,
  EditorCatalog,
  FieldDefinition,
  JsonObject,
  JsonValue,
  SourceRef,
} from './shared/protocol';
import { isRecord, isJsonValue } from './shared/guards';
import { relativePath } from './paths';
import { parse } from 'yaml';

export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
export const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
export const jsonObject = (value: unknown): JsonObject =>
  isRecord(value) && isJsonValue(value) ? (value as JsonObject) : {};
export function projectFile(root: string, value: unknown): string {
  const filename = text(value);
  return relativePath(root, filename) ?? filename.replaceAll('\\', '/');
}
export function sourceRef(root: string, value: unknown): SourceRef {
  const s = record(value);
  const source: SourceRef = {
    path: projectFile(root, s.path),
    documentIndex: typeof s.document_index === 'number' ? s.document_index : 0,
    yamlPath: items(s.yaml_path).filter(
      (v): v is string | number => typeof v === 'string' || typeof v === 'number',
    ),
  };
  if (typeof s.line === 'number' && typeof s.column === 'number')
    source.range = {
      start: { line: s.line, character: s.column },
      end: {
        line: typeof s.end_line === 'number' ? s.end_line : s.line,
        character: typeof s.end_column === 'number' ? s.end_column : s.column + 1,
      },
    };
  return source;
}
function dereference(schema: unknown, root: JsonObject): JsonObject {
  let s = jsonObject(schema);
  if (Array.isArray(s.anyOf)) s = jsonObject(s.anyOf.find((v) => record(v).type !== 'null'));
  if (typeof s.$ref !== 'string' || !s.$ref.startsWith('#/')) return s;
  let value: unknown = root;
  for (const key of s.$ref.slice(2).split('/')) value = record(value)[key];
  return jsonObject(value);
}
function atPath(value: unknown, path: string[]): unknown {
  for (const key of path) value = record(value)[key];
  return value;
}
function schemaField(
  schema: JsonObject,
  root: JsonObject,
  path: string[],
  sample: unknown,
): FieldDefinition {
  let current = schema;
  let required = false;
  for (const key of path) {
    required = items(current.required).includes(key);
    current = dereference(record(current.properties)[key], root);
  }
  const inferred = Array.isArray(sample)
    ? 'array'
    : sample !== null && typeof sample === 'object'
      ? 'object'
      : typeof sample;
  const kind = text(current.type, inferred);
  const type = (
    ['number', 'boolean', 'object', 'array'].includes(kind)
      ? kind
      : kind === 'integer'
        ? 'number'
        : 'string'
  ) as FieldDefinition['type'];
  return {
    name: path.join('.'),
    label: path.join(' / ').replaceAll('_', ' '),
    type,
    required,
    description: text(current.description),
    choices: Array.isArray(current.enum) ? current.enum : undefined,
    default: current.default === null ? undefined : current.default,
  };
}
/** Installed, version-matched help supplies subtype forms and working skeletons.
 * Pydantic supplies field types; canonical validation remains authoritative. */
function actionDefinitions(data: Record<string, unknown>): ActionDefinition[] {
  const action = jsonObject(data.action_schema);
  const entries = items(record(data.action_help).entries).map(record);
  const overviews = entries.filter(
    (entry) =>
      text(entry.id).endsWith('.overview') &&
      items(entry.bindings).some((b) => items(record(b).path).length === 0),
  );
  return overviews.map((overview) => {
    const binding = record(items(overview.bindings)[0]);
    const [type = '', subtype = ''] = text(binding.subtype).split(':');
    let defaults: JsonObject = {};
    const example = text(record(items(overview.examples)[0]).yaml);
    try {
      defaults = jsonObject(parse(example));
    } catch {
      /* A missing example is explicitly completed by the user. */
    }
    defaults.name = '';
    defaults.type = type;
    const paths = new Map<string, { path: string[]; help?: Record<string, unknown> }>();
    for (const key of ['name', 'type', ...Object.keys(defaults)]) {
      const value = defaults[key];
      if (isRecord(value))
        for (const nested of Object.keys(value))
          paths.set(`${key}.${nested}`, { path: [key, nested] });
      else paths.set(key, { path: [key] });
    }
    for (const entry of entries)
      for (const raw of items(entry.bindings)) {
        const b = record(raw);
        const path = items(b.path).filter((v): v is string => typeof v === 'string');
        if (b.subtype === `${type}:${subtype}` && path.length)
          paths.set(path.join('.'), { path, help: entry });
      }
    const fields = [...paths.values()].map(({ path, help }) => {
      const field = schemaField(action, action, path, atPath(defaults, path));
      if (help)
        field.description = [text(help.summary), ...items(help.details).map((v) => text(v))]
          .filter(Boolean)
          .join(' ');
      return field;
    });
    return {
      type,
      subtype,
      label: `${type} · ${subtype}`,
      description: text(overview.summary),
      fields,
      defaults,
      schema: action,
    };
  });
}
function parameterField(value: unknown, name?: string): FieldDefinition {
  const v = record(value);
  const kind = text(v.type_ ?? v.type, 'string');
  const field: FieldDefinition = {
    name: name ?? text(v.name),
    label: name ?? text(v.name),
    description: text(v.description),
    type: (['number', 'boolean', 'object', 'array'].includes(kind)
      ? kind
      : kind === 'integer'
        ? 'number'
        : 'string') as FieldDefinition['type'],
    required: v.required === true,
  };
  if (v.has_default === true || ('default' in v && v.default !== null))
    field.default = v.default as JsonValue;
  return field;
}
export function normalizeCatalog(root: string, value: unknown): EditorCatalog {
  const data = record(value);
  const schemas = record(data.schemas);
  return {
    actions: actionDefinitions(data),
    schemas: Object.entries(schemas).map(([kind, schema]) => ({
      kind,
      schema: jsonObject(schema),
      patterns: [],
    })),
    templates: items(data.templates).map((v) => {
      const t = record(v);
      return {
        name:
          projectFile(root, t.file_path)
            .replace(/^templates\//, '')
            .replace(/\.ya?ml$/, '') || text(t.name),
        description: text(t.description),
        source: { path: projectFile(root, t.file_path) },
        fields: items(t.parameters).map((p) => parameterField(p)),
      };
    }),
    presets: items(data.presets).map((v) => {
      const p = record(v);
      return {
        name: text(p.name),
        description: text(p.description),
        source: { path: projectFile(root, p.file_path) },
      };
    }),
    blueprints: items(data.blueprints).map((v) => {
      const b = record(v);
      return {
        name: text(b.name),
        description: text(b.description),
        source: { path: projectFile(root, b.file_path) },
        consumers: items(b.instances).map((i) => projectFile(root, record(i).instance_file_path)),
        fields: items(record(data.blueprint_parameters)[text(b.name)]).map((parameter) =>
          parameterField(parameter),
        ),
      };
    }),
  };
}
