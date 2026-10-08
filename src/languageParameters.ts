import { parseAllDocuments } from 'yaml';
import type { EditorCatalog, FieldDefinition, SourceRef } from './shared/protocol';
import type { YamlCursorContext } from './languageContext';

export interface ParameterContext {
  kind: 'template' | 'blueprint';
  definition: string;
  source: SourceRef;
  fields: FieldDefinition[];
  field?: FieldDefinition;
  atKey: boolean;
}

/** Resolve the instance enclosing this parameter map, including sequence roots and document streams. */
export function parameterContext(
  source: string,
  cursor: YamlCursorContext,
  catalog?: EditorCatalog,
): ParameterContext | undefined {
  if (!catalog || cursor.suppressed) return undefined;
  const parameterIndex = cursor.path.findIndex(
    (part) => part === 'template_parameters' || part === 'parameters',
  );
  if (parameterIndex < 0 || cursor.path.length > parameterIndex + 2) return undefined;
  const parameterKey = cursor.path[parameterIndex];
  const kind = parameterKey === 'template_parameters' ? 'template' : 'blueprint';
  const document = parseAllDocuments(source, { strict: false, uniqueKeys: false })[
    cursor.documentIndex
  ];
  if (!document) return undefined;
  const instance = cursor.path.slice(0, parameterIndex);
  const useKey = kind === 'template' ? 'use_template' : 'use_blueprint';
  const definition = document.getIn([...instance, useKey]);
  if (typeof definition !== 'string') return undefined;
  const item = (kind === 'template' ? catalog.templates : catalog.blueprints).find(
    (entry) => entry.name === definition,
  );
  if (!item) return undefined;
  const fieldName = cursor.path[parameterIndex + 1];
  return {
    kind,
    definition,
    source: item.source,
    fields: item.fields,
    field:
      typeof fieldName === 'string'
        ? item.fields.find((field) => field.name === fieldName)
        : undefined,
    atKey: cursor.role === 'key' || cursor.path.length === parameterIndex + 1,
  };
}
