import { isAlias, isMap, isNode, isScalar, isSeq, parseAllDocuments, type Pair } from 'yaml';

export type YamlSegment = string | number;
export interface YamlCursorContext {
  documentIndex: number;
  path: YamlSegment[];
  role: 'key' | 'value' | 'root';
  key?: string;
  value?: string;
  valueRange?: readonly [number, number];
  /** The complete key path of the nearest action mapping, when available. */
  actionPath?: YamlSegment[];
  actionType?: string;
  actionSubtype?: string;
  suppressed: boolean;
}

function within(node: unknown, offset: number): boolean {
  return isNode(node) && !!node.range && node.range[0] <= offset && offset <= node.range[2];
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

/** YAML comments are ignored outside quoted scalars. A hash in a string stays data. */
function inComment(source: string, offset: number): boolean {
  const start = lineStart(source, offset);
  let quote: '"' | "'" | undefined;
  for (let i = start; i < offset; i++) {
    const char = source[i];
    if (quote === '"' && char === '\\') {
      i++;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && source[i + 1] === "'") i++;
      else quote = undefined;
    } else if (!quote && (char === '"' || char === "'")) quote = char;
    else if (!quote && char === '#' && (i === start || /\s/.test(source[i - 1]!))) return true;
  }
  return false;
}

function scalar(node: unknown): string | undefined {
  return isScalar(node) && node.value !== null && node.value !== undefined
    ? String(node.value)
    : undefined;
}

function mappingInfo(node: unknown): { type?: string; subtype?: string } {
  if (!isMap(node)) return {};
  const get = (name: string): string | undefined =>
    scalar(node.items.find((pair) => scalar(pair.key) === name)?.value);
  const nested = (name: string, field: string): string | undefined => {
    const value = node.items.find((pair) => scalar(pair.key) === name)?.value;
    return isMap(value)
      ? scalar(value.items.find((pair) => scalar(pair.key) === field)?.value)
      : undefined;
  };
  const type = get('type');
  return {
    type,
    subtype:
      type === 'load'
        ? nested('source', 'type')
        : type === 'transform'
          ? get('transform_type')
          : type === 'write'
            ? nested('write_target', 'type')
            : type === 'test'
              ? get('test_type')
              : undefined,
  };
}

interface SearchResult {
  path: YamlSegment[];
  role: 'key' | 'value';
  key?: string;
  value?: string;
  valueRange?: readonly [number, number];
  actionPath?: YamlSegment[];
  actionType?: string;
  actionSubtype?: string;
  blockScalar?: boolean;
  alias?: boolean;
}

function visit(
  node: unknown,
  source: string,
  offset: number,
  path: YamlSegment[],
  action?: Pick<SearchResult, 'actionPath' | 'actionType' | 'actionSubtype'>,
): SearchResult | undefined {
  if (!isNode(node)) return undefined;
  if (isAlias(node)) return { path, role: 'value', alias: true, ...action };
  if (isSeq(node)) {
    for (let index = 0; index < node.items.length; index++) {
      const item = node.items[index];
      if (!within(item, offset)) continue;
      const result = visit(item, source, offset, [...path, index], action);
      if (result) return result;
    }
    return { path, role: 'value', ...action };
  }
  if (isMap(node)) {
    const info = mappingInfo(node);
    const isAction =
      path.at(-2) === 'actions' &&
      typeof path.at(-1) === 'number' &&
      ['load', 'transform', 'write', 'test'].includes(info.type ?? '');
    const currentAction = isAction
      ? { actionPath: path, actionType: info.type, actionSubtype: info.subtype }
      : action;
    for (const pair of node.items as Pair[]) {
      const key = scalar(pair.key);
      if (key === undefined) continue;
      const member = [...path, key];
      if (within(pair.key, offset)) return { path: member, role: 'key', key, ...currentAction };
      if (within(pair.value, offset)) {
        const nested = visit(pair.value, source, offset, member, currentAction);
        return (
          nested ?? {
            path: member,
            role: 'value',
            key,
            value: scalar(pair.value),
            ...currentAction,
          }
        );
      }
      // A null/incomplete value still belongs to the key on the same line.
      if (!pair.value && isNode(pair.key) && pair.key.range) {
        const keyEnd = pair.key.range[2];
        const end = source.indexOf('\n', keyEnd);
        if (keyEnd <= offset && (end < 0 || offset <= end))
          return { path: member, role: 'value', key, ...currentAction };
      }
    }
    return { path, role: 'value', ...currentAction };
  }
  return {
    path,
    role: 'value',
    value: scalar(node),
    valueRange: node.range ? [node.range[0], node.range[1]] : undefined,
    blockScalar: isScalar(node) && String(node.type).startsWith('BLOCK_'),
    ...action,
  };
}

/** Tolerant local parse. Never invokes Python or edits the document. */
export function analyzeYaml(source: string): (offset: number) => YamlCursorContext {
  const documents = parseAllDocuments(source, {
    keepSourceTokens: true,
    strict: false,
    uniqueKeys: false,
  });
  return (offset: number): YamlCursorContext => {
    const position = Math.max(0, Math.min(offset, source.length));
    const documentIndex = Math.max(
      0,
      documents.findIndex((document) =>
        document.range ? document.range[0] <= position && position <= document.range[2] : false,
      ),
    );
    const document = documents[documentIndex];
    const result = document?.contents ? visit(document.contents, source, position, []) : undefined;
    return {
      documentIndex,
      path: result?.path ?? [],
      role: result?.role ?? 'root',
      key:
        result?.key ??
        (typeof result?.path.at(-1) === 'string' ? String(result.path.at(-1)) : undefined),
      value: result?.value,
      valueRange: result?.valueRange,
      actionPath: result?.actionPath,
      actionType: result?.actionType,
      actionSubtype: result?.actionSubtype,
      suppressed: inComment(source, position) || !!result?.blockScalar || !!result?.alias,
    };
  };
}

export function yamlCursorContext(source: string, offset: number): YamlCursorContext {
  return analyzeYaml(source)(offset);
}
