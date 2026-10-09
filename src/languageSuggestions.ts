import type { EditorCatalog, ProjectSnapshot, SourceRef } from './shared/protocol';
import type { ProjectResourceIndex } from './shared/projectModel';
import type { YamlCursorContext } from './languageContext';
import type { LhpSchemaKind } from './languageClassification';
import { stringify } from 'yaml';

export interface Suggestion {
  label: string;
  detail?: string;
  source?: SourceRef;
  kind?: 'reference' | 'file' | 'snippet';
  insertText?: string;
}

function unique(values: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = JSON.stringify([entry.label, entry.source?.path]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function actionField(context: YamlCursorContext, key: string): boolean {
  return (
    !!context.actionPath &&
    context.path[context.actionPath.length] === key &&
    context.path.slice(context.actionPath.length + 1).every((part) => typeof part === 'number')
  );
}
function fieldName(context: YamlCursorContext): string | undefined {
  const tail = context.path.at(-1);
  return typeof tail === 'string'
    ? tail
    : typeof context.path.at(-2) === 'string'
      ? String(context.path.at(-2))
      : undefined;
}

/** Cheap in-memory LHP references. A caller must first classify the document. */
export function referenceSuggestions(
  schema: LhpSchemaKind | undefined,
  context: YamlCursorContext,
  catalog?: EditorCatalog,
  index?: ProjectResourceIndex,
  snapshot?: ProjectSnapshot,
): Suggestion[] {
  if (!schema || context.suppressed || context.role !== 'value') return [];
  const key = fieldName(context);
  if (!key) return [];
  if (!['authoring', 'template', 'blueprint', 'instance', 'flowgroup'].includes(schema)) {
    if (schema === 'substitution' && key === 'value') return [];
    return [];
  }
  if (key === 'use_template' && !context.actionPath)
    return unique(
      catalog?.templates.map((item) => ({
        label: item.name,
        detail: item.description ?? item.source.path,
        source: item.source,
        kind: 'reference',
      })) ?? [],
    );
  if (key === 'use_blueprint' && !context.actionPath)
    return unique(
      catalog?.blueprints.map((item) => ({
        label: item.name,
        detail: item.description ?? item.source.path,
        source: item.source,
        kind: 'reference',
      })) ?? [],
    );
  if ((key === 'preset' || key === 'presets') && !context.actionPath)
    return unique(
      catalog?.presets.map((item) => ({
        label: item.name,
        detail: item.description ?? item.source?.path,
        source: item.source,
        kind: 'reference',
      })) ?? [],
    );
  if ((key === 'source' || key === 'depends_on') && actionField(context, key))
    return unique(
      snapshot?.flowgroups.flatMap((group) =>
        group.actions.flatMap((action) =>
          action.outputs.map((name) => ({
            label: name,
            detail: `${group.pipeline} / ${group.name} / ${action.name}`,
            source: action.source,
            kind: 'reference' as const,
          })),
        ),
      ) ?? [],
    );
  if (
    context.actionPath &&
    /^(?:sql_path|module_path|schema_file|expectations_file|tags_file)$/.test(key)
  ) {
    const kinds =
      key === 'sql_path'
        ? ['sql']
        : key === 'module_path'
          ? ['python']
          : key === 'expectations_file'
            ? ['expectations']
            : ['schema'];
    return unique(
      index?.files
        .filter((file) => kinds.includes(file.kind))
        .map((file) => ({
          label: file.path,
          detail: file.exists ? file.kind : `${file.kind} · missing`,
          source: file.source,
          kind: 'file',
        })) ?? [],
    );
  }
  return [];
}

export function substitutionSuggestions(
  schema: LhpSchemaKind | undefined,
  context: YamlCursorContext,
  index?: ProjectResourceIndex,
  environment?: string,
): Suggestion[] {
  if (!schema || context.suppressed || context.role !== 'value' || !index || !environment)
    return [];
  if (!['authoring', 'template', 'blueprint', 'instance', 'flowgroup'].includes(schema)) return [];
  return unique(
    index.tokens
      .filter((token) => token.environment === environment)
      .map((token) => ({
        label: token.name,
        detail: `${token.environment} substitution${token.secretReference ? ' · secret reference name' : ''}`,
        source: token.source,
        kind: 'reference',
      })),
  );
}

/** Existing YAML list marker belongs to the document, not to the snippet body. */
export function snippetForLine(snippet: string, linePrefix: string): string {
  return /(?:^|\n)\s*-\s*$/.test(linePrefix) ? snippet.replace(/^- /, '') : snippet;
}

export function actionSnippets(
  schema: LhpSchemaKind | undefined,
  context: YamlCursorContext,
  catalog?: EditorCatalog,
): Suggestion[] {
  if (!catalog || schema !== 'authoring' || context.suppressed || context.role !== 'value')
    return [];
  if (
    !(context.path.at(-2) === 'actions' && typeof context.path.at(-1) === 'number') &&
    context.path.at(-1) !== 'actions'
  )
    return [];
  return catalog.actions.map((action) => {
    const body: Record<string, unknown> = {
      ...structuredClone(action.defaults),
      name: 'LHP_TABSTOP_1',
    };
    let next = 2;
    for (const field of action.fields.filter((entry) => entry.required)) {
      const parts = field.name.split('.');
      let mapping = body;
      for (const part of parts.slice(0, -1)) {
        const value = mapping[part];
        if (!value || typeof value !== 'object' || Array.isArray(value)) mapping[part] = {};
        mapping = mapping[part] as Record<string, unknown>;
      }
      const leaf = parts.at(-1)!;
      if (mapping[leaf] === undefined) mapping[leaf] = `LHP_TABSTOP_${next++}`;
    }
    const yaml = stringify(body, { lineWidth: 0 })
      .trimEnd()
      .replace(/^/gm, '  ')
      .replace(/^ {2}/, '- ')
      .replace(
        /LHP_TABSTOP_(\d+)/g,
        (_whole, number: string) =>
          `\${${number}:${number === '1' ? `${action.type}_action` : 'value'}}`,
      );
    return {
      label: action.label,
      detail: action.description,
      insertText: yaml,
      kind: 'snippet' as const,
    };
  });
}
