import type {
  ActionNode,
  DocumentState,
  FlowgroupDetail,
  GraphEdge,
  JsonObject,
  JsonValue,
  ProjectDatasetIndex,
  ProjectSnapshot,
  SourceRef,
} from '../../src/shared/protocol';

export interface GraphItem {
  id: string;
  name: string;
  kicker: string;
  detail: string;
  readonly: boolean;
}

export interface GraphModel {
  items: GraphItem[];
  edges: GraphEdge[];
}

export function projectGraph(snapshot: ProjectSnapshot, selected?: Set<string>): GraphModel {
  const allNames = new Set(snapshot.pipelines.map((pipeline) => pipeline.name));
  // Keep immediate upstream pipelines in view as dependency context. Showing
  // them does not add them to the canonical sandbox generation scope.
  const names = selected ? new Set([...selected].filter((name) => allNames.has(name))) : allNames;
  if (selected)
    for (const edge of snapshot.pipelineEdges ?? []) {
      if (selected.has(edge.target) && allNames.has(edge.source)) names.add(edge.source);
    }
  return {
    items: snapshot.pipelines
      .filter((pipeline) => names.has(pipeline.name))
      .map((pipeline) => ({
        id: pipeline.name,
        name: pipeline.name,
        kicker:
          selected && !selected.has(pipeline.name) ? 'Shared input · outside scope' : 'Pipeline',
        detail: `${pipeline.flowgroups.length} flowgroup${pipeline.flowgroups.length === 1 ? '' : 's'}`,
        readonly: Boolean(selected && !selected.has(pipeline.name)),
      })),
    edges: (snapshot.pipelineEdges ?? []).filter(
      (edge) => names.has(edge.source) && names.has(edge.target),
    ),
  };
}

export function datasetGraph(index: ProjectDatasetIndex): GraphModel {
  const ids = new Set(index.datasets.map((dataset) => dataset.id));
  return {
    items: index.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      kicker: dataset.kind === 'external' ? 'External input' : dataset.kind,
      detail: `${dataset.producers.length} producer${dataset.producers.length === 1 ? '' : 's'} · ${dataset.consumers.length} consumer${dataset.consumers.length === 1 ? '' : 's'}`,
      readonly: dataset.kind === 'external',
    })),
    edges: index.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

export function pipelineGraph(snapshot: ProjectSnapshot, pipeline: string): GraphModel {
  const summaries = snapshot.pipelines.find((item) => item.name === pipeline)?.flowgroups ?? [];
  const ids = new Set(summaries.map((item) => item.id));
  const edges = snapshot.flowgroupEdges.filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  return {
    items: summaries.map((item) => ({
      id: item.id,
      name: item.name,
      kicker: 'Flowgroup',
      detail: `${item.actionCount} action${item.actionCount === 1 ? '' : 's'} · ${item.origin.kind}`,
      readonly: item.origin.kind !== 'direct',
    })),
    edges,
  };
}

export function actionGraph(detail: FlowgroupDetail): GraphModel {
  const ids = new Set(detail.actions.map((action) => action.id));
  return {
    items: detail.actions.map((action) => ({
      id: action.id,
      name: action.name || '(unnamed action)',
      kicker: `${action.type}${action.subtype ? ` / ${action.subtype}` : ''}`,
      detail: action.outputs.join(', ') || action.inputs.join(', ') || action.origin.kind,
      readonly: !action.editable,
    })),
    edges: detail.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

/** Stable layered layout that preserves real edges and leaves cycles selectable. */
export function layoutGraph(
  items: GraphItem[],
  edges: GraphEdge[],
): Record<string, { x: number; y: number }> {
  const ids = new Set(items.map((item) => item.id));
  const incoming = new Map(items.map((item) => [item.id, 0]));
  const outgoing = new Map(items.map((item) => [item.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const ready = items.map((item) => item.id).filter((id) => incoming.get(id) === 0);
  const ranks = new Map<string, number>();
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const id = ready[cursor];
    if (id === undefined) continue;
    ranks.set(id, ranks.get(id) ?? 0);
    for (const next of outgoing.get(id) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1));
      incoming.set(next, (incoming.get(next) ?? 1) - 1);
      if (incoming.get(next) === 0) ready.push(next);
    }
  }
  // Cyclic nodes cannot be ranked by Kahn's algorithm. Place them in a final
  // column; the edge itself still renders and can be inspected/disconnected.
  let lastRank = 0;
  for (const rank of ranks.values()) lastRank = Math.max(lastRank, rank);
  for (const item of items) if (!ranks.has(item.id)) ranks.set(item.id, lastRank + 1);
  const rows = new Map<number, number>();
  return Object.fromEntries(
    items.map((item) => {
      const rank = ranks.get(item.id) ?? 0;
      const row = rows.get(rank) ?? 0;
      rows.set(rank, row + 1);
      return [item.id, { x: 32 + rank * 330, y: 34 + row * 116 }];
    }),
  );
}

export function documentVersions(snapshot: ProjectSnapshot): Record<string, number> {
  return Object.fromEntries(snapshot.documents.map((doc) => [doc.path, doc.version]));
}

export function documentForSource(
  snapshot: ProjectSnapshot,
  source: SourceRef,
): DocumentState | undefined {
  return snapshot.documents.find((doc) => doc.path === source.path);
}

/** Compare navigation targets, ignoring display labels. */
export function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return (
    left.path === right.path &&
    (left.documentIndex ?? 0) === (right.documentIndex ?? 0) &&
    JSON.stringify(left.yamlPath ?? null) === JSON.stringify(right.yamlPath ?? null) &&
    JSON.stringify(left.range ?? null) === JSON.stringify(right.range ?? null)
  );
}

export function actionById(snapshot: ProjectSnapshot, id: string): ActionNode | undefined {
  return snapshot.flowgroups.flatMap((detail) => detail.actions).find((action) => action.id === id);
}

export function asRecord(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function fieldValue(object: JsonObject, name: string): JsonValue | undefined {
  const segments = name.split('.');
  let value: JsonValue | undefined = object;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = value[segment];
  }
  return value;
}

export function setFieldValue(object: JsonObject, name: string, value: JsonValue): JsonObject {
  const segments = name.split('.');
  const next: JsonObject = structuredClone(object);
  let cursor: JsonObject = next;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== 'object' || Array.isArray(current)) cursor[segment] = {};
    cursor = cursor[segment] as JsonObject;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined) cursor[last] = value;
  return next;
}
