import type {
  ActionNode,
  EditorDiagnostic,
  FlowgroupDetail,
  GraphEdge,
  ProjectContext,
  ProjectSnapshot,
  RelatedFile,
  SourceRef,
} from './shared/protocol';
import { items, jsonObject, normalizeCatalog, record, sourceRef, text } from './catalog';

const stringList = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : items(v).filter((s): s is string => typeof s === 'string');
const identity = (s: SourceRef, name: string) =>
  `${s.path}#${s.documentIndex ?? 0}:${JSON.stringify(s.yamlPath ?? [])}:${name}`;
function subtype(action: Record<string, unknown>): string | undefined {
  return (
    text(
      action.transform_type ??
        action.test_type ??
        record(action.source).type ??
        record(action.write_target).type,
    ) || undefined
  );
}
export function normalizeDiagnostics(root: string, value: unknown): EditorDiagnostic[] {
  return items(value).map((v) => {
    const d = record(v);
    return {
      severity:
        d.severity === 'warning'
          ? 'warning'
          : d.severity === 'information'
            ? 'information'
            : 'error',
      message: text(d.message, 'LHP reported a diagnostic.'),
      code: text(d.code) || undefined,
      layer:
        d.layer === 'syntax' ? 'syntax' : d.layer === 'generation' ? 'generation' : 'configuration',
      source: d.source ? sourceRef(root, d.source) : undefined,
    };
  });
}
function relatedFiles(root: string, value: unknown): RelatedFile[] {
  return items(value).map((v) => {
    const f = record(v);
    return {
      ...sourceRef(root, { path: f.path }),
      kind: text(f.kind, 'config') as RelatedFile['kind'],
      exists: f.exists === true,
      editable: f.exists === true,
    };
  });
}
/** Converts public DTO casing/shapes; all resolution and SQL analysis stay in LHP. */
export function normalizeSnapshot(
  root: string,
  value: unknown,
  context: ProjectContext,
  revision: number,
): ProjectSnapshot {
  const data = record(value);
  const flowgroups: FlowgroupDetail[] = items(data.flowgroups).map((value) => {
    const fg = record(value);
    const source = sourceRef(root, fg.source);
    const id = identity(source, text(fg.name));
    const origin = {
      kind:
        fg.origin === 'template'
          ? ('template' as const)
          : fg.origin === 'blueprint'
            ? ('blueprint' as const)
            : fg.origin === 'generated'
              ? ('generated' as const)
              : ('direct' as const),
      definition: fg.definition ? sourceRef(root, fg.definition) : undefined,
      instance: fg.instance ? sourceRef(root, fg.instance) : undefined,
    };
    const actions: ActionNode[] = items(fg.actions).map((value) => {
      const a = record(value);
      const raw = jsonObject(a.raw);
      const resolved = jsonObject(a.resolved);
      const source = sourceRef(root, a.source);
      const outputs = stringList(a.outputs ?? resolved.target);
      const write = record(resolved.write_target);
      if (typeof write.table === 'string')
        outputs.push(
          [write.catalog, write.schema, write.table]
            .filter((v) => typeof v === 'string' && v)
            .join('.'),
        );
      const inputs = stringList(a.inputs ?? resolved.source);
      inputs.push(...stringList(resolved.depends_on));
      return {
        id: identity(source, `${id}:${text(a.name)}`),
        name: text(a.name),
        type: text(a.action_type),
        subtype: subtype(resolved),
        flowgroupId: id,
        source,
        raw,
        resolved,
        inputs: [...new Set(inputs)],
        outputs: [...new Set(outputs)],
        relatedFiles: relatedFiles(root, a.related_files),
        origin: {
          ...origin,
          kind:
            a.origin === 'template'
              ? 'template'
              : a.origin === 'blueprint'
                ? 'blueprint'
                : a.origin === 'generated'
                  ? 'generated'
                  : 'direct',
        },
        editable: a.editable === true,
        readOnlyReason:
          a.editable === true
            ? undefined
            : a.origin === 'generated'
              ? 'Configure this generated action through monitoring settings in lhp.yaml.'
              : 'Generated action: configure its instance or open the shared definition.',
      };
    });
    return {
      id,
      name: text(fg.name),
      pipeline: text(fg.pipeline),
      source,
      actionCount: actions.length,
      origin,
      raw: jsonObject(fg.raw),
      actions,
      edges: [],
      instanceEditable: fg.origin !== 'generated' && (!!fg.instance || fg.editable === true),
      editable: fg.editable === true,
      readOnlyReason:
        fg.editable === true
          ? undefined
          : fg.origin === 'generated'
            ? 'Configure monitoring in lhp.yaml; generated actions have no editable action YAML.'
            : 'Add actions through the template or blueprint definition.',
    };
  });
  const dependencies = record(data.dependencies);
  const canonicalActions = record(dependencies.action_graph);
  const byCanonical = new Map<string, ActionNode>();
  for (const raw of items(canonicalActions.nodes)) {
    const node = record(raw);
    const fg = flowgroups.find((f) => f.pipeline === node.pipeline && f.name === node.flowgroup);
    const action = fg?.actions.find((a) => a.name === node.label);
    if (action) byCanonical.set(text(node.id), action);
  }
  // Edges come exclusively from LHP's canonical dependency analysis, including
  // references discovered in SQL/Python. Dataset matching below only labels them.
  const edges: GraphEdge[] = items(canonicalActions.edges).flatMap((raw, index) => {
    const edge = record(raw);
    const source = byCanonical.get(text(edge.source));
    const target = byCanonical.get(text(edge.target));
    if (!source || !target) return [];
    const matched = source.outputs.find((dataset) => target.inputs.includes(dataset));
    const dataset = text(edge.dataset, matched ?? source.outputs[0] ?? 'dependency');
    const direct =
      typeof target.raw.source === 'string' ||
      (Array.isArray(target.raw.source) && target.raw.source.every((v) => typeof v === 'string'));
    const editable =
      target.editable && direct && target.type !== 'load' && target.subtype !== 'sql' && !!matched;
    return [
      {
        id: `${source.id}>${target.id}:${index}`,
        source: source.id,
        target: target.id,
        dataset,
        editable,
        reason: editable
          ? undefined
          : 'This dependency is derived from code or a shared definition. Open its native source to edit it.',
      },
    ];
  });
  for (const fg of flowgroups)
    fg.edges = edges.filter((edge) =>
      fg.actions.some((a) => a.id === edge.source || a.id === edge.target),
    );
  const canonicalFlowgroups = record(dependencies.flowgroup_graph);
  const byGroup = new Map<string, FlowgroupDetail>();
  for (const raw of items(canonicalFlowgroups.nodes)) {
    const node = record(raw);
    const fg = flowgroups.find((f) => f.pipeline === node.pipeline && f.name === node.flowgroup);
    if (fg) byGroup.set(text(node.id), fg);
  }
  const flowgroupEdges: GraphEdge[] = items(canonicalFlowgroups.edges).flatMap((raw, index) => {
    const edge = record(raw);
    const source = byGroup.get(text(edge.source));
    const target = byGroup.get(text(edge.target));
    return source && target
      ? [
          {
            id: `${source.id}>${target.id}:${index}`,
            source: source.id,
            target: target.id,
            dataset: text(edge.dataset, 'data dependency'),
            editable: false,
            reason: 'Drill into actions to inspect this dependency.',
          },
        ]
      : [];
  });
  const environments = items(data.environments).map((v) => text(v));
  return {
    revision,
    context: { ...context, environment: text(data.environment, context.environment), environments },
    flowgroups,
    flowgroupEdges,
    pipelines: [...new Set(flowgroups.map((f) => f.pipeline))]
      .sort()
      .map((name) => ({ name, flowgroups: flowgroups.filter((f) => f.pipeline === name) })),
    catalog: normalizeCatalog(root, data.catalog),
    documents: [],
    diagnostics: normalizeDiagnostics(root, data.diagnostics),
    stale: data.stale === true,
    notices: [
      'Graphs use LHP dependency analysis. Native source files remain authoritative.',
      ...items(dependencies.external_sources).map((v) => `External dataset: ${text(v)}`),
      ...items(dependencies.warnings).map((v) => text(v)),
    ],
  };
}
