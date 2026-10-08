import { expect, it } from 'vitest';
import { normalizeDatasets } from '../../src/datasets';
import { normalizeSnapshot } from '../../src/snapshot';
import type { ProjectContext } from '../../src/shared/protocol';

it('preserves canonical external/table/sink direction and exact source ownership without duplicates', () => {
  const context: ProjectContext = {
    project: { id: 'p', name: 'demo', rootLabel: 'demo' },
    environment: 'dev',
    environments: ['dev'],
    trusted: true,
    runtime: { compatible: true, interpreter: 'python', capabilities: [] },
  };
  const flowgroups = ['orders', 'clean', 'events'].map((name, index) => ({
    pipeline: 'main',
    name,
    source: { path: 'pipelines/multiple.yaml', document_index: index },
    raw: {},
    actions: [
      {
        name: `write_${name}`,
        action_type: 'write',
        source: {
          path: 'pipelines/multiple.yaml',
          document_index: index,
          yaml_path: ['actions', 1],
        },
        raw: {},
        resolved: {},
      },
    ],
  }));
  const snapshot = normalizeSnapshot('/project', { flowgroups }, context, 4);
  const raw = {
    env: 'dev',
    datasets: [
      {
        fqn: 'main.bronze.orders',
        kind: 'table',
        pipeline: 'main',
        flowgroup: 'orders',
        action_name: 'write_orders',
        source_file: 'pipelines/multiple.yaml',
        upstream: [{ kind: 'external', label: '/Volumes/raw/orders' }],
        consumers: [
          {
            dataset_fqn: 'main.silver.clean',
            pipeline: 'main',
            flowgroup: 'clean',
            action_name: 'write_clean',
          },
        ],
      },
      {
        fqn: 'main.silver.clean',
        kind: 'table',
        pipeline: 'main',
        flowgroup: 'clean',
        action_name: 'write_clean',
        source_file: 'pipelines/multiple.yaml',
        upstream: [
          { kind: 'dataset', dataset_fqn: 'main.bronze.orders' },
          { kind: 'dataset', dataset_fqn: 'main.silver.clean' },
        ],
        consumers: [
          {
            dataset_fqn: 'sink:kafka/events',
            pipeline: 'main',
            flowgroup: 'events',
            action_name: 'write_events',
          },
        ],
      },
      {
        fqn: 'sink:kafka/events',
        kind: 'sink',
        pipeline: 'main',
        flowgroup: 'events',
        action_name: 'write_events',
        source_file: 'pipelines/multiple.yaml',
        upstream: [{ kind: 'dataset', dataset_fqn: 'main.silver.clean' }],
        consumers: [],
      },
    ],
    warnings: [],
  };
  const index = normalizeDatasets('/project', raw, snapshot);
  const names = new Map(index.datasets.map((entry) => [entry.id, entry.name]));
  expect(index.datasets).toHaveLength(4);
  expect(index.edges.map((edge) => [names.get(edge.source), names.get(edge.target)])).toEqual([
    ['/Volumes/raw/orders', 'main.bronze.orders'],
    ['main.bronze.orders', 'main.silver.clean'],
    ['main.silver.clean', 'sink:kafka/events'],
  ]);
  const orders = index.datasets.find((entry) => entry.name === 'main.bronze.orders')!;
  expect(orders.producers[0]?.source).toEqual(snapshot.flowgroups[0]?.actions[0]?.source);
  expect(orders.consumers[0]?.source).toEqual(snapshot.flowgroups[1]?.actions[0]?.source);
  expect(orders.consumers[0]?.source?.documentIndex).toBe(1);
  expect(index.datasets.find((entry) => entry.kind === 'external')?.producers).toEqual([]);
  expect(
    index.datasets.find((entry) => entry.kind === 'sink')?.producers[0]?.source?.documentIndex,
  ).toBe(2);
});
