import { describe, expect, it } from 'vitest';
import { SidebarModel, type SidebarNode, type SidebarState } from '../../src/sidebarModel';
import { demoSnapshot } from '../../webview/src/demoFixture';

function state(overrides: Partial<SidebarState> = {}): SidebarState {
  const snapshot = demoSnapshot();
  return {
    projects: [
      snapshot.context.project,
      { id: 'other', name: 'Other', rootLabel: 'workspace/other' },
    ],
    selectedProjectId: snapshot.context.project.id,
    snapshot,
    trusted: true,
    revision: snapshot.revision,
    ...overrides,
  };
}

function descendants(model: SidebarModel): {
  project: SidebarNode;
  pipeline: SidebarNode;
  group: SidebarNode;
  action: SidebarNode;
} {
  const project = model.roots()[0]!;
  const pipeline = model.children(project).find((node) => node.label === 'bronze_load')!;
  const group = model.children(pipeline).find((node) => node.label === 'orders_bronze')!;
  const action = model.children(group).find((node) => node.label === 'cleanse_orders')!;
  return { project, pipeline, group, action };
}

describe('native LHP project tree model', () => {
  it('materializes hierarchy only as expanded and keeps inactive projects isolated', () => {
    const model = new SidebarModel();
    model.update(state());
    const roots = model.roots();
    expect(roots.map((node) => node.label)).toEqual(['Demo Lakehouse', 'Other']);
    expect(roots[1]?.childrenAvailable).toBe(false);
    expect(model.children(roots[1])).toEqual([]);

    const pipelineRef = {
      id: JSON.stringify(['demo', 'pipeline', 'bronze_load']),
      kind: 'pipeline',
      projectId: 'demo',
      revision: 7,
    };
    expect(() => model.resolve(pipelineRef)).toThrow(/stale/i);
    const { project, pipeline, group, action } = descendants(model);
    expect(model.resolve(pipelineRef)).toEqual(pipeline);
    expect(model.getParent(pipeline)).toEqual(project);
    expect(model.getParent(group)).toEqual(pipeline);
    expect(model.getParent(action)).toEqual(group);
    expect(model.children(action)).toMatchObject([
      { kind: 'file', source: { path: 'sql/cleanse_orders.sql' }, missing: false },
    ]);
  });

  it('preserves shared-source provenance and distinct related-file addresses', () => {
    const model = new SidebarModel();
    model.update(state());
    const project = model.roots()[0]!;
    const pipeline = model.children(project)[0]!;
    const inherited = model
      .children(pipeline)
      .find((node) => node.label === 'inventory_ingestion')!;
    const action = model.children(inherited)[0]!;
    const files = model.children(action);
    expect(files.map((node) => node.description)).toEqual(['shared definition', 'instance YAML']);
    expect(files.map((node) => node.source?.path)).toEqual([
      'templates/standard_ingestion.yaml',
      'pipelines/bronze/inventory_ingestion.yaml',
    ]);
    expect(files.every((node) => model.getParent(node)?.id === action.id)).toBe(true);
  });

  it('rejects stale and forged nodes after a revision or project change', () => {
    const model = new SidebarModel();
    model.update(state());
    const { action } = descendants(model);
    expect(() => model.resolve({ ...action, projectId: 'other' })).toThrow(/stale/i);
    expect(() => model.resolve({ ...action, kind: 'file' })).toThrow(/stale/i);
    model.update(state({ revision: 8 }));
    expect(() => model.resolve(action)).toThrow(/stale/i);
    model.update(state({ selectedProjectId: 'other', snapshot: undefined, revision: 9 }));
    expect(model.children(model.roots()[0])).toEqual([]);
    expect(model.roots()[1]?.description).toContain('active');
  });

  it('keeps file identity tied to its path when related files change at the same revision', () => {
    const model = new SidebarModel();
    const original = state();
    model.update(original);
    const { action } = descendants(model);
    const previousFile = model.children(action)[0]!;
    expect(previousFile.source?.path).toBe('sql/cleanse_orders.sql');

    const snapshot = original.snapshot!;
    const group = snapshot.flowgroups[0]!;
    const editedAction = {
      ...group.actions[1]!,
      relatedFiles: [
        { path: 'sql/new.sql', kind: 'sql' as const, exists: true, editable: true },
        group.actions[1]!.relatedFiles[0]!,
      ],
    };
    const changed = {
      ...snapshot,
      flowgroups: [
        { ...group, actions: [group.actions[0]!, editedAction, group.actions[2]!] },
        ...snapshot.flowgroups.slice(1),
      ],
    };
    expect(model.update({ ...original, snapshot: changed })).toBe(true);
    const currentAction = descendants(model).action;
    const files = model.children(currentAction);
    expect(files.map((node) => node.source?.path)).toEqual([
      'sql/new.sql',
      'sql/cleanse_orders.sql',
    ]);
    expect(model.resolve(previousFile).source?.path).toBe('sql/cleanse_orders.sql');

    const replacedAction = { ...editedAction, relatedFiles: editedAction.relatedFiles.slice(0, 1) };
    const replaced = {
      ...changed,
      flowgroups: [
        { ...group, actions: [group.actions[0]!, replacedAction, group.actions[2]!] },
        ...snapshot.flowgroups.slice(1),
      ],
    };
    expect(model.update({ ...original, snapshot: replaced })).toBe(true);
    descendants(model);
    expect(() => model.resolve(previousFile)).toThrow(/stale/i);
  });

  it('does not rebuild hierarchy on operation-only progress updates', () => {
    const model = new SidebarModel();
    const initial = state();
    expect(model.update(initial)).toBe(true);
    const project = model.roots()[0]!;
    expect(
      model.update({
        ...initial,
        operation: { operation: 'validate', running: true, message: 'Validating…' },
      }),
    ).toBe(false);
    expect(model.roots()[0]).toBe(project);
    expect(model.message).toBe('Validating…');
  });

  it('expands a large synthetic project without materializing every action row', () => {
    const base = demoSnapshot();
    const template = base.flowgroups[0]!;
    const groups = Array.from({ length: 4_017 }, (_, index) => {
      const id = `synthetic-${index}`;
      const count = index < 2_698 ? 5 : 4;
      return {
        ...template,
        id,
        name: id,
        actions: Array.from({ length: count }, (_, actionIndex) => ({
          ...template.actions[0]!,
          id: `${id}:action-${actionIndex}`,
          name: `action-${actionIndex}`,
          flowgroupId: id,
        })),
        actionCount: count,
      };
    });
    const snapshot = {
      ...base,
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
    expect(groups.reduce((total, group) => total + group.actionCount, 0)).toBe(18_766);
    const model = new SidebarModel();
    const initial = state({ snapshot });
    model.update(initial);
    const project = model.roots()[0]!;
    const [pipeline] = model.children(project);
    expect(pipeline?.kind).toBe('pipeline');
    const flowgroups = model.children(pipeline);
    expect(flowgroups).toHaveLength(4_017);
    const unopenedAction = {
      id: JSON.stringify(['demo', 'action', 'synthetic-0:action-0']),
      kind: 'action',
      projectId: 'demo',
      revision: snapshot.revision,
    };
    expect(() => model.resolve(unopenedAction)).toThrow(/stale/i);
    expect(model.children(flowgroups[0])).toHaveLength(5);
    expect(model.resolve(unopenedAction).kind).toBe('action');
    expect(model.update({ ...initial, snapshot: { ...snapshot, refreshState: 'loading' } })).toBe(
      false,
    );
    expect(model.roots()[0]).toBe(project);
  });

  it('reports no-project, trust, loading, runtime, failure and stale states accurately', () => {
    const model = new SidebarModel();
    model.update({ projects: [], trusted: true, revision: 0 });
    expect(model.message).toBeUndefined();
    model.update(state({ trusted: false }));
    expect(model.message).toMatch(/Trust this workspace/);
    model.update(state({ snapshot: undefined }));
    expect(model.message).toMatch(/Refresh/);
    model.update(
      state({ operation: { operation: 'snapshot', running: true, message: 'Loading…' } }),
    );
    expect(model.message).toBe('Loading…');
    const runtime = demoSnapshot('runtime');
    model.update(state({ snapshot: runtime }));
    expect(model.message).toMatch(/integration build/);
    model.update(
      state({
        snapshot: { ...demoSnapshot(), refreshState: 'failed', refreshError: 'Transport failed' },
      }),
    );
    expect(model.message).toBe('Transport failed');
    model.update(state({ snapshot: { ...demoSnapshot(), refreshState: 'loading' } }));
    expect(model.message).toMatch(/Refreshing/);
    model.update(state({ snapshot: { ...demoSnapshot(), stale: true } }));
    expect(model.message).toMatch(/last valid graph/);
  });
});
