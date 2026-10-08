import { describe, expect, it } from 'vitest';
import { SidebarViewsModel, type ViewState } from '../../src/sidebarViewsModel';
import type { ProjectResourceIndex, ProjectDatasetIndex } from '../../src/shared/projectModel';
import { demoSnapshot } from '../../webview/src/demoFixture';

const snapshot = demoSnapshot();
const projectId = snapshot.context.project.id;
const inventory: ProjectResourceIndex = {
  projectId,
  revision: 1,
  complete: true,
  loading: false,
  warnings: [],
  environments: ['dev'],
  tokens: [],
  files: [
    {
      id: 'template',
      kind: 'template',
      path: 'templates/nested/reader.yaml',
      name: 'nested/reader',
      source: { path: 'templates/nested/reader.yaml' },
      exists: true,
      registered: true,
      consumers: [],
    },
    {
      id: 'bundle',
      kind: 'configuration',
      path: 'templates/bundle/job_config.yaml',
      name: 'job_config.yaml',
      source: { path: 'templates/bundle/job_config.yaml' },
      configurationKind: 'bundle-template',
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'broken',
      kind: 'blueprint',
      path: 'blueprints/broken.yaml',
      name: 'broken',
      source: { path: 'blueprints/broken.yaml' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'sql',
      kind: 'sql',
      path: 'queries/a.sql',
      name: 'a.sql',
      source: { path: 'queries/a.sql' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'pipeline-file',
      kind: 'pipeline',
      path: 'custom/orders.yaml',
      name: 'orders.yaml',
      source: { path: 'custom/orders.yaml' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'output',
      kind: 'generated',
      path: 'out/dev/bronze/orders.py',
      name: 'orders.py',
      source: { path: 'out/dev/bronze/orders.py' },
      exists: true,
      registered: false,
      consumers: [],
      generatedKind: 'source',
      environment: 'dev',
    },
  ],
};
const datasets: ProjectDatasetIndex = {
  projectId,
  revision: 1,
  environment: 'dev',
  stale: false,
  warnings: [],
  edges: [],
  datasets: [
    {
      id: 'table',
      name: 'main.bronze.orders',
      kind: 'table',
      producers: [
        {
          label: 'write_orders',
          source: { path: 'pipelines/orders.yaml' },
          pipeline: 'bronze_load',
        },
      ],
      consumers: [],
      upstream: [],
      downstream: [],
    },
    {
      id: 'external',
      name: 'samples.tpch.orders',
      kind: 'external',
      producers: [],
      consumers: [{ label: 'load_orders' }],
      upstream: [],
      downstream: [],
    },
  ],
};
function state(overrides: Partial<ViewState> = {}): ViewState {
  return {
    projects: [snapshot.context.project],
    selectedProjectId: projectId,
    snapshot,
    resourceIndex: inventory,
    catalog: snapshot.catalog,
    datasets,
    runtime: snapshot.context.runtime,
    environment: 'dev',
    activePipelineConfig: 'config/pipeline_config.yaml',
    trusted: true,
    revision: 1,
    ...overrides,
  };
}

describe('five native LHP views', () => {
  it('shows exactly five configuration rows and source-aware active config', () => {
    const model = new SidebarViewsModel();
    model.update(state());
    const rows = model.roots('configuration');
    expect(rows.map((row) => row.label)).toEqual([
      'Project',
      'Environment',
      'Python / LHP',
      'Active pipeline config',
      'Settings',
    ]);
    expect(rows[3]?.source?.path).toBe('config/pipeline_config.yaml');
    expect(model.children(rows[4]!).map((row) => row.source?.path)).toContain(
      'templates/bundle/job_config.yaml',
    );
  });

  it('indexes every physical resource category without treating bundle config as a flow template', () => {
    const model = new SidebarViewsModel();
    model.update(state({ snapshot: undefined, trusted: false }));
    const categories = model.roots('resources');
    expect(categories.map((row) => row.label)).toEqual([
      'Templates',
      'Blueprints',
      'Presets',
      'Schemas & transforms',
      'Expectations',
      'SQL',
      'Python',
    ]);
    expect(model.children(categories[0]!).map((row) => row.source?.path)).toEqual([
      'templates/nested/reader.yaml',
    ]);
    expect(model.children(categories[1]!).map((row) => row.label)).toEqual(['broken']);
    expect(model.children(categories[5]!).map((row) => row.label)).toEqual(['a.sql']);
  });

  it('keeps data external and generated output persisted-only with stable opaque identities', () => {
    const model = new SidebarViewsModel();
    model.update(state());
    const [declared, external] = model.roots('data');
    expect(model.children(declared!).map((row) => row.label)).toEqual(['main.bronze.orders']);
    const externalNode = model.children(external!)[0]!;
    expect(externalNode.label).toBe('samples.tpch.orders');
    expect(model.children(externalNode)[0]?.source).toBeUndefined();
    const env = model.roots('generated')[0]!;
    const kind = model.children(env)[0]!;
    const output = model.children(kind)[0]!;
    expect(output.resourceId).toBe('output');
    expect(output.source?.path).toBe('out/dev/bronze/orders.py');
    expect(model.resolve(output)).toBe(output);
    model.update(state({ revision: 2 }));
    expect(() => model.resolve(output)).toThrow(/stale/i);
  });

  it('drops cached YAML addresses for stale lineage while preserving the owning file', () => {
    const source = {
      path: 'pipelines/orders.yaml',
      documentIndex: 1,
      yamlPath: ['actions', 1] as (string | number)[],
    };
    const indexed = {
      ...datasets,
      revision: snapshot.revision,
      datasets: [
        {
          ...datasets.datasets[0]!,
          producers: [{ label: 'write_orders', source, pipeline: 'bronze_load' }],
        },
      ],
    };
    const model = new SidebarViewsModel();
    const relation = () => {
      const declared = model.roots('data')[0]!;
      const dataset = model.children(declared)[0]!;
      return model.children(dataset)[0]!;
    };
    model.update(state({ datasets: indexed }));
    expect(relation().stale).toBeFalsy();
    expect(relation().source).toEqual(source);
    model.update(state({ datasets: { ...indexed, stale: true } }));
    expect(relation().stale).toBe(true);
    expect(relation().source?.path).toBe(source.path);
    expect(model.message('data')).toMatch(/stale/i);
    expect(model.update(state({ datasets: indexed, snapshot: { ...snapshot, stale: true } }))).toBe(
      true,
    );
    expect(relation().stale).toBe(true);
    model.update(state({ datasets: indexed, snapshot: { ...snapshot, revision: 8 } }));
    expect(relation().stale).toBe(true);
  });

  it('keeps inherited definition and instance file addresses distinct', () => {
    const model = new SidebarViewsModel();
    model.update(state());
    const pipeline = model.roots('pipelines').find((row) => row.kind === 'pipeline')!;
    const group = model.children(pipeline).find((row) => row.label === 'inventory_ingestion')!;
    const action = model.children(group)[0]!;
    const files = model.children(action);
    expect(files.map((row) => row.description)).toEqual(['shared definition', 'instance YAML']);
    expect(files.map((row) => row.source?.path)).toEqual([
      'templates/standard_ingestion.yaml',
      'pipelines/bronze/inventory_ingestion.yaml',
    ]);
    expect(files.every((row) => model.parent(row)?.id === action.id)).toBe(true);
  });

  it('invalidates removed related files without rebuilding on unchanged progress state', () => {
    const model = new SidebarViewsModel();
    const initial = state();
    expect(model.update(initial)).toBe(true);
    const roots = model.roots('pipelines');
    expect(model.update({ ...initial })).toBe(false);
    expect(model.roots('pipelines')).toBe(roots);
    const group = model
      .children(roots.find((row) => row.kind === 'pipeline')!)
      .find((row) => row.label === 'orders_bronze')!;
    const action = model.children(group).find((row) => row.label === 'cleanse_orders')!;
    const prior = model.children(action)[0]!;
    const first = snapshot.flowgroups[0]!;
    const changedAction = {
      ...first.actions[1]!,
      relatedFiles: [{ path: 'sql/new.sql', kind: 'sql' as const, exists: true, editable: true }],
    };
    const updated = {
      ...snapshot,
      flowgroups: [
        { ...first, actions: [first.actions[0]!, changedAction, first.actions[2]!] },
        ...snapshot.flowgroups.slice(1),
      ],
    };
    expect(model.update(state({ snapshot: updated }))).toBe(true);
    const nextGroup = model
      .children(model.roots('pipelines').find((row) => row.kind === 'pipeline')!)
      .find((row) => row.label === 'orders_bronze')!;
    const nextAction = model.children(nextGroup).find((row) => row.label === 'cleanse_orders')!;
    expect(model.children(nextAction).map((row) => row.source?.path)).toEqual(['sql/new.sql']);
    expect(() => model.resolve(prior)).toThrow(/stale/i);
  });

  it('opens pipeline and flowgroup graph, action source, and only builds action rows on expansion', () => {
    const model = new SidebarViewsModel();
    model.update(state());
    const pipeline = model.roots('pipelines').find((row) => row.kind === 'pipeline')!;
    expect(pipeline.intent).toBe('designer');
    const group = model.children(pipeline)[0]!;
    expect(group.intent).toBe('designer');
    const unopened = {
      id: JSON.stringify([
        projectId,
        'pipelines',
        'action',
        snapshot.flowgroups[0]!.actions[0]!.id,
      ]),
      kind: 'action',
      projectId,
      revision: 1,
    };
    expect(() => model.resolve(unopened)).toThrow(/stale/i);
    const action = model.children(group)[0]!;
    expect(action.intent).toBe('source');
    expect(model.resolve(unopened)).toBe(action);
    expect(model.parent(action)).toBe(group);
    expect(
      model
        .children(model.roots('pipelines').find((row) => row.group === 'authoring')!)
        .map((row) => row.source?.path),
    ).toEqual(['custom/orders.yaml']);
  });

  it('keeps cheap physical browsing when semantic state is unavailable', () => {
    const model = new SidebarViewsModel();
    model.update(
      state({ snapshot: undefined, datasets: undefined, trusted: false, runtime: undefined }),
    );
    expect(model.roots('resources')).toHaveLength(7);
    expect(model.roots('pipelines').some((row) => row.group === 'authoring')).toBe(true);
    expect(model.roots('data')[0]?.intent).toBe('none');
    expect(model.roots('data')[0]?.label).toMatch(/Trust/);
    expect(model.message('pipelines')).toMatch(/Trust/);
  });

  it('distinguishes an unknown file index from a complete empty one', () => {
    const model = new SidebarViewsModel();
    model.update(state({ snapshot: undefined, resourceIndex: undefined, runtime: undefined }));
    expect(model.roots('resources')[0]?.description).toBe('Index not loaded');
    expect(model.roots('generated')[0]?.label).toBe('File index not loaded.');
    model.update(state({ snapshot: undefined, resourceIndex: { ...inventory, files: [] } }));
    expect(model.roots('resources')[0]?.description).toBe('0');
    expect(model.roots('generated')[0]?.label).toBe('No persisted generated output found.');
  });

  it('projects 4,017 groups and 18,766 actions without creating unopened action nodes', () => {
    const template = snapshot.flowgroups[0]!;
    const groups = Array.from({ length: 4_017 }, (_, index) => {
      const id = `scale-${index}`;
      const count = index < 2_698 ? 5 : 4;
      return {
        ...template,
        id,
        name: id,
        actionCount: count,
        actions: Array.from({ length: count }, (_, actionIndex) => ({
          ...template.actions[0]!,
          id: `${id}:${actionIndex}`,
          name: `action-${actionIndex}`,
          flowgroupId: id,
        })),
      };
    });
    expect(groups.reduce((total, group) => total + group.actionCount, 0)).toBe(18_766);
    const big = {
      ...snapshot,
      flowgroups: groups,
      pipelines: [
        {
          name: 'bronze_load',
          flowgroups: groups.map(({ id, name, pipeline, source, actionCount, origin }) => ({
            id,
            name,
            pipeline,
            source,
            actionCount,
            origin,
          })),
        },
      ],
    };
    const model = new SidebarViewsModel();
    model.update(state({ snapshot: big }));
    const pipeline = model.roots('pipelines')[0]!;
    const flowgroups = model.children(pipeline);
    expect(flowgroups).toHaveLength(4_017);
    const unopened = {
      id: JSON.stringify([projectId, 'pipelines', 'action', 'scale-0:0']),
      kind: 'action',
      projectId,
      revision: 1,
    };
    expect(() => model.resolve(unopened)).toThrow(/stale/i);
    expect(model.children(flowgroups[0]!)).toHaveLength(5);
    expect(model.resolve(unopened).label).toBe('action-0');
  });
});
