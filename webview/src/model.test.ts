import { describe, expect, it } from 'vitest';
import {
  actionGraph,
  datasetGraph,
  documentVersions,
  fieldValue,
  layoutGraph,
  pipelineGraph,
  projectGraph,
  setFieldValue,
} from './model';
import { demoSnapshot } from './demoFixture';

describe('webview graph models', () => {
  it('uses authoritative cross-flowgroup edges for pipeline graph', () => {
    const snapshot = demoSnapshot();
    const graph = pipelineGraph(snapshot, 'bronze_load');
    expect(graph.items.map((item) => item.id)).toEqual(['orders', 'customers', 'inventory']);
    expect(graph.edges.map((edge) => [edge.source, edge.target, edge.dataset])).toEqual([
      ['orders', 'customers', 'customer_reference'],
      ['customers', 'inventory', 'inventory_lookup'],
    ]);
    expect(pipelineGraph(snapshot, 'silver_curate').edges).toEqual([]);
  });

  it('draws the project map only from canonical pipeline edges', () => {
    const snapshot = {
      ...demoSnapshot(),
      pipelineEdges: [
        {
          id: 'real',
          source: 'bronze_load',
          target: 'silver_curate',
          dataset: 'orders',
          editable: false,
        },
        {
          id: 'unknown',
          source: 'missing',
          target: 'silver_curate',
          dataset: 'unknown',
          editable: false,
        },
      ],
    };
    const graph = projectGraph(snapshot);
    expect(graph.items.map((item) => item.id)).toEqual(['bronze_load', 'silver_curate']);
    expect(graph.edges.map((edge) => edge.id)).toEqual(['real']);
    expect(projectGraph({ ...snapshot, pipelineEdges: undefined }).edges).toEqual([]);
  });

  it('shows declared dataset identities and only matching lineage edges', () => {
    const graph = datasetGraph({
      projectId: 'demo',
      revision: 7,
      environment: 'dev',
      stale: false,
      warnings: [],
      datasets: [
        {
          id: 'input',
          name: 'landing.orders',
          kind: 'external',
          producers: [],
          consumers: [],
          upstream: [],
          downstream: ['output'],
        },
        {
          id: 'output',
          name: 'bronze.orders',
          kind: 'table',
          producers: [{ label: 'write_orders' }],
          consumers: [],
          upstream: ['input'],
          downstream: [],
        },
      ],
      edges: [
        { id: 'declared', source: 'input', target: 'output', dataset: 'orders', editable: false },
        { id: 'unknown', source: 'missing', target: 'output', dataset: '', editable: false },
      ],
    });
    expect(graph.items[0]).toMatchObject({ kicker: 'External input', readonly: true });
    expect(graph.edges.map((edge) => edge.id)).toEqual(['declared']);
  });

  it('uses actual action dependencies, not sequence-adjacent invented edges', () => {
    const detail = demoSnapshot().flowgroups[0]!;
    const graph = actionGraph(detail);
    expect(graph.edges.map((edge) => edge.dataset)).toEqual(['v_orders_raw', 'v_orders_clean']);
    expect(graph.items[0]?.readonly).toBe(false);
    expect(actionGraph(demoSnapshot().flowgroups[2]!).items[0]?.readonly).toBe(true);
  });

  it('positions a DAG in dependency layers and retains cyclic nodes', () => {
    const graph = actionGraph(demoSnapshot().flowgroups[0]!);
    const positions = layoutGraph(graph.items, graph.edges);
    expect(positions['orders:load']!.x).toBeLessThan(positions['orders:cleanse']!.x);
    expect(positions['orders:cleanse']!.x).toBeLessThan(positions['orders:write']!.x);
    const cyclic = layoutGraph(graph.items.slice(0, 2), [
      { id: 'a', source: 'orders:load', target: 'orders:cleanse', dataset: 'a', editable: true },
      { id: 'b', source: 'orders:cleanse', target: 'orders:load', dataset: 'b', editable: true },
    ]);
    expect(Object.keys(cyclic)).toHaveLength(2);
  });

  it('updates nested fields without dropping unknown action keys', () => {
    const source = {
      name: 'load',
      source: { type: 'cloudfiles', path: '/old', options: { custom: true } },
      custom: 7,
    };
    const next = setFieldValue(source, 'source.path', '/new');
    expect(fieldValue(next, 'source.path')).toBe('/new');
    expect(fieldValue(next, 'source.options.custom')).toBe(true);
    expect(source.source.path).toBe('/old');
    expect(next.custom).toBe(7);
  });

  it('includes native document versions in every edit request', () => {
    expect(documentVersions(demoSnapshot())).toMatchObject({
      'pipelines/bronze/orders_bronze.yaml': 4,
    });
  });
});
