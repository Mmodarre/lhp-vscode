import { isMap, isSeq, parseAllDocuments, type Document, type Node, type Pair } from 'yaml';
import type {
  ActionMutation,
  ActionNode,
  DocumentSnapshot,
  JsonObject,
  JsonValue,
  ProjectSnapshot,
  SourceRef,
  YamlPath,
} from './shared/protocol';

export interface DocumentEdit {
  path: string;
  version: number;
  text: string;
}
interface Draft {
  original: DocumentSnapshot;
  documents: Document[];
}
function getAt(document: Document, yamlPath: YamlPath): unknown {
  return yamlPath.length ? document.getIn(yamlPath, true) : document.contents;
}
function replaceMapping(document: Document, yamlPath: YamlPath, value: JsonObject): void {
  const current = getAt(document, yamlPath);
  if (!isMap(current)) throw new Error('The source mapping changed. Refresh before editing.');
  for (const pair of [...current.items]) {
    const key = String(pair.key);
    if (!(key in value)) current.delete(key);
  }
  for (const [key, next] of Object.entries(value)) {
    const old = current.get(key, true);
    const plain = old && typeof old === 'object' && 'toJSON' in old ? old.toJSON() : old;
    if (JSON.stringify(plain) !== JSON.stringify(next)) {
      if (isMap(old) && next !== null && typeof next === 'object' && !Array.isArray(next)) {
        replaceMapping(document, [...yamlPath, key], next);
        continue;
      }
      const replacement = document.createNode(next);
      if (old && typeof old === 'object' && 'comment' in old) {
        replacement.comment = (old as Node).comment;
        replacement.commentBefore = (old as Node).commentBefore;
      }
      current.set(key, replacement);
    }
  }
}
function assertName(raw: JsonObject): void {
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Action name is required.');
  if (typeof raw.type !== 'string' || !raw.type) throw new Error('Action type is required.');
}
function directInputs(value: JsonValue | undefined): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  return undefined;
}
function connectSource(
  action: ActionNode,
  dataset: string,
  resolvedDataset: string,
  remove: boolean,
): JsonObject {
  if (
    action.type === 'load' ||
    action.subtype === 'sql' ||
    action.raw.transform_type === 'sql' ||
    typeof action.raw.sql === 'string' ||
    typeof action.raw.sql_path === 'string'
  ) {
    throw new Error(
      'This dependency is defined in source code. Open its native source file to change the connection.',
    );
  }
  const inputs = directInputs(action.raw.source);
  if (!inputs)
    throw new Error(
      'This action uses a structured source. Configure its source mapping to change connections.',
    );
  const resolved = directInputs(action.resolved?.source) ?? [];
  const matches = (input: string, index: number) =>
    input === dataset || input === resolvedDataset || resolved[index] === resolvedDataset;
  if (remove && !inputs.some(matches))
    throw new Error(
      'This connection is no longer present in the editable source. Refresh the graph.',
    );
  const next = remove
    ? inputs.filter((input, index) => !matches(input, index))
    : inputs.some(matches)
      ? inputs
      : [...inputs, dataset];
  const raw = structuredClone(action.raw);
  if (next.length === 0) delete raw.source;
  else raw.source = next.length === 1 ? next[0]! : next;
  return raw;
}
function assertAcyclic(snapshot: ProjectSnapshot, source: string, target: string): void {
  const seen = new Set<string>();
  const stack = [target];
  const edges = snapshot.flowgroups.flatMap((fg) => fg.edges);
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) throw new Error('This connection would create a dependency cycle.');
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...edges.filter((e) => e.source === id).map((e) => e.target));
  }
}

/** Mechanical CST edits only; LHP remains responsible for domain validation. */
export function planMutation(
  snapshot: ProjectSnapshot,
  mutation: ActionMutation,
  current: DocumentSnapshot[],
  versions: Record<string, number>,
): DocumentEdit[] {
  if (snapshot.stale)
    throw new Error('Resolve invalid source and refresh before editing the graph.');
  const drafts = new Map<string, Draft>();
  const action = (id: string): ActionNode => {
    const node = snapshot.flowgroups.flatMap((fg) => fg.actions).find((a) => a.id === id);
    if (!node) throw new Error('Action no longer exists. Refresh the graph.');
    if (!node.editable)
      throw new Error(
        node.readOnlyReason || 'Edit this generated action through its instance or definition.',
      );
    return node;
  };
  const draft = (source: SourceRef): { doc: Document; path: YamlPath } => {
    let item = drafts.get(source.path);
    if (!item) {
      const original = current.find((d) => d.path === source.path);
      if (!original || versions[source.path] !== original.version)
        throw new Error('The document changed. Refresh the form before applying edits.');
      const documents = parseAllDocuments(original.text, {
        keepSourceTokens: true,
        uniqueKeys: true,
      });
      if (!documents.length || documents.some((d) => d.errors.length))
        throw new Error('Fix YAML syntax errors before using form edits.');
      item = { original, documents };
      drafts.set(source.path, item);
    }
    const doc = item.documents[source.documentIndex ?? 0];
    if (!doc) throw new Error('YAML document no longer exists.');
    return { doc, path: source.yamlPath ?? [] };
  };
  const configure = (node: ActionNode, values: JsonObject): void => {
    assertName(values);
    if (
      snapshot.flowgroups
        .find((fg) => fg.id === node.flowgroupId)
        ?.actions.some((a) => a.id !== node.id && a.name === values.name)
    )
      throw new Error('An action with that name already exists in the flowgroup.');
    const { doc, path } = draft(node.source);
    replaceMapping(doc, path, values);
  };
  switch (mutation.kind) {
    case 'add': {
      const fg = snapshot.flowgroups.find((f) => f.id === mutation.flowgroupId);
      if (!fg || !fg.editable)
        throw new Error(fg?.readOnlyReason || 'This flowgroup is not directly editable.');
      assertName(mutation.action);
      if (fg.actions.some((a) => a.name === mutation.action.name))
        throw new Error('An action with that name already exists.');
      const { doc, path } = draft(fg.source);
      const sequencePath = [...path, 'actions'];
      if (!doc.hasIn(sequencePath)) doc.setIn(sequencePath, []);
      const sequence = doc.getIn(sequencePath, true);
      if (!isSeq(sequence)) throw new Error('Flowgroup actions must be a YAML sequence.');
      sequence.add(doc.createNode(mutation.action));
      break;
    }
    case 'configure':
      configure(action(mutation.actionId), mutation.values);
      break;
    case 'configureFlowgroup': {
      const fg = snapshot.flowgroups.find((f) => f.id === mutation.flowgroupId);
      if (!fg?.instanceEditable) throw new Error('This flowgroup instance is not editable.');
      const { doc, path } = draft(fg.origin.instance ?? fg.source);
      replaceMapping(doc, path, mutation.values);
      break;
    }
    case 'delete': {
      const node = action(mutation.actionId);
      const { doc, path } = draft(node.source);
      if (!path.length || path[path.length - 2] !== 'actions')
        throw new Error('Cannot remove this action at its source address.');
      doc.deleteIn(path);
      break;
    }
    case 'duplicate': {
      const node = action(mutation.actionId);
      const values = structuredClone(node.raw);
      values.name = mutation.newName;
      if (typeof values.target === 'string') {
        const occupied = new Set(
          snapshot.flowgroups
            .flatMap((fg) => fg.actions)
            .flatMap((a) => [a.raw.target, ...a.outputs]),
        );
        const base = `${values.target}_copy`;
        let target = base;
        let number = 2;
        while (occupied.has(target)) target = `${base}${number++}`;
        values.target = target;
      }
      if (
        values.write_target &&
        typeof values.write_target === 'object' &&
        !Array.isArray(values.write_target) &&
        typeof values.write_target.table === 'string'
      ) {
        const occupied = new Set(
          snapshot.flowgroups
            .flatMap((fg) => fg.actions)
            .map((a) => {
              const target = a.raw.write_target;
              return target && typeof target === 'object' && !Array.isArray(target)
                ? target.table
                : undefined;
            }),
        );
        const base = `${values.write_target.table}_copy`;
        let candidate = base;
        let index = 2;
        while (occupied.has(candidate)) candidate = `${base}${index++}`;
        values.write_target.table = candidate;
      }
      return planMutation(
        snapshot,
        { kind: 'add', flowgroupId: node.flowgroupId, action: values },
        current,
        versions,
      );
    }
    case 'connect':
    case 'disconnect': {
      const upstream = snapshot.flowgroups
        .flatMap((f) => f.actions)
        .find((a) => a.id === mutation.sourceId);
      const downstream = action(mutation.targetId);
      if (!upstream || !upstream.outputs.includes(mutation.dataset))
        throw new Error('Choose an output produced by the upstream action.');
      if (mutation.kind === 'connect') assertAcyclic(snapshot, upstream.id, downstream.id);
      const rawDataset =
        typeof upstream.raw.target === 'string' ? upstream.raw.target : mutation.dataset;
      configure(
        downstream,
        connectSource(downstream, rawDataset, mutation.dataset, mutation.kind === 'disconnect'),
      );
      break;
    }
    case 'setValue': {
      const { doc, path } = draft(mutation.source);
      if (!path.length) throw new Error('Use a flowgroup form to replace the document root.');
      doc.setIn(path, mutation.value);
      break;
    }
  }
  return [...drafts].map(([path, value]) => ({
    path,
    version: value.original.version,
    text: value.documents.map((d) => d.toString()).join(''),
  }));
}

/** Fallback native reveal when a public API source location has no range. */
export function sourceOffset(text: string, source: SourceRef): number {
  const docs = parseAllDocuments(text, { keepSourceTokens: true });
  const doc = docs[source.documentIndex ?? 0];
  if (!doc || doc.errors.length) return 0;
  const node = getAt(doc, source.yamlPath ?? []) as Node | Pair | null;
  return node && 'range' in node ? (node.range?.[0] ?? 0) : 0;
}
