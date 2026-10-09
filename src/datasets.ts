import { createHash } from 'node:crypto';
import { items, record, text, sourceRef } from './catalog';
import type {
  DatasetEntry,
  DatasetSource,
  ProjectDatasetIndex,
  ProjectSnapshot,
} from './shared/protocol';

const datasetId = (kind: string, name: string): string =>
  createHash('sha256')
    .update(JSON.stringify([kind, name]))
    .digest('base64url');

/** Normalize canonical table lineage; intermediate action graphs stay in snapshot. */
export function normalizeDatasets(
  root: string,
  value: unknown,
  snapshot: ProjectSnapshot,
): ProjectDatasetIndex {
  const raw = record(value);
  const entries = new Map<string, DatasetEntry>();
  const groups = new Map(
    snapshot.flowgroups.map((fg) => [JSON.stringify([fg.pipeline, fg.name]), fg]),
  );
  const actionSource = (
    recorded: Record<string, unknown>,
    fallbackPath?: string,
  ): DatasetSource => {
    const group = groups.get(JSON.stringify([recorded.pipeline, recorded.flowgroup]));
    const action = group?.actions.find((item) => item.name === recorded.action_name);
    return {
      label: [recorded.pipeline, recorded.flowgroup, recorded.action_name]
        .filter(Boolean)
        .join(' / '),
      source:
        action?.source ??
        group?.source ??
        (fallbackPath ? sourceRef(root, { path: fallbackPath }) : undefined),
      pipeline: text(recorded.pipeline) || undefined,
      flowgroupId: group?.id,
      actionId: action?.id,
    };
  };
  const ensure = (name: string, kind: DatasetEntry['kind']): DatasetEntry => {
    const key = JSON.stringify([kind === 'external' ? 'external' : 'produced', name]);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        id: datasetId(key, name),
        name,
        kind,
        producers: [],
        consumers: [],
        upstream: [],
        downstream: [],
      };
      entries.set(key, entry);
    }
    return entry;
  };
  for (const item of items(raw.datasets)) {
    const data = record(item);
    const entry = ensure(text(data.fqn), data.kind === 'sink' ? 'sink' : 'table');
    entry.producers.push(actionSource(data, text(data.source_file)));
    entry.consumers.push(
      ...items(data.consumers).map((consumer) => actionSource(record(consumer))),
    );
  }
  const edges = new Map<string, ProjectDatasetIndex['edges'][number]>();
  const connect = (source: DatasetEntry, target: DatasetEntry) => {
    if (source.id === target.id) return;
    source.downstream.push(target.id);
    target.upstream.push(source.id);
    const id = `${source.id}>${target.id}`;
    edges.set(id, {
      id,
      source: source.id,
      target: target.id,
      dataset: source.name,
      editable: false,
      reason: 'Canonical data lineage; edit the producer or consumer source.',
    });
  };
  for (const item of items(raw.datasets)) {
    const data = record(item);
    const entry = ensure(text(data.fqn), data.kind === 'sink' ? 'sink' : 'table');
    for (const rawUpstream of items(data.upstream)) {
      const upstream = record(rawUpstream);
      const name = text(upstream.dataset_fqn) || text(upstream.label);
      if (!name) continue;
      const source = ensure(
        name,
        upstream.kind === 'external' ? 'external' : name.startsWith('sink:') ? 'sink' : 'table',
      );
      if (source.kind === 'external') source.consumers.push(...entry.producers);
      connect(source, entry);
    }
    for (const rawConsumer of items(data.consumers)) {
      const consumer = record(rawConsumer);
      const name = text(consumer.dataset_fqn);
      if (name) connect(entry, ensure(name, name.startsWith('sink:') ? 'sink' : 'table'));
    }
  }
  return {
    projectId: snapshot.context.project.id,
    revision: snapshot.revision,
    environment: text(raw.env, snapshot.context.environment),
    stale: snapshot.stale,
    datasets: [...entries.values()].map((entry) => ({
      ...entry,
      upstream: [...new Set(entry.upstream)],
      downstream: [...new Set(entry.downstream)],
      consumers: [
        ...new Map(entry.consumers.map((source) => [JSON.stringify(source), source])).values(),
      ],
    })),
    edges: [...edges.values()],
    warnings: items(raw.warnings).map((item) => text(item)),
  };
}
