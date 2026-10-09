import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { planMutation } from '../../src/yamlEdits';
import { normalizeSnapshot } from '../../src/snapshot';
import type { ProjectContext } from '../../src/shared/protocol';

const context: ProjectContext = {
  project: { id: 'p', name: 'project', rootLabel: 'project' },
  environment: 'dev',
  environments: ['dev'],
  trusted: true,
  runtime: { interpreter: 'python', compatible: true, capabilities: [] },
};
function fixture(
  text = 'flowgroup: orders\npipeline: bronze\nactions:\n  - name: load\n    type: load\n    source:\n      type: cloudfiles\n      path: /input # retain nested comment\n    target: "${view}"\n  - name: write\n    type: write\n    source: "${view}"\n    write_target:\n      type: streaming_table\n      table: orders\n',
) {
  const docs = parseAllDocuments(text);
  const documentIndex = docs.length - 1;
  const last = docs[documentIndex]!.toJS();
  const grouped = Array.isArray(last.flowgroups);
  const raw = grouped ? last.flowgroups[0] : last;
  const base = grouped ? ['flowgroups', 0] : [];
  const source = (yaml_path: (string | number)[]) => ({
    path: 'pipelines/orders.yaml',
    document_index: documentIndex,
    yaml_path,
  });
  const snapshot = normalizeSnapshot(
    '/project',
    {
      flowgroups: [
        {
          name: raw.flowgroup,
          pipeline: raw.pipeline,
          raw,
          source: source(base),
          instance: source(base),
          origin: 'direct',
          editable: true,
          actions: raw.actions.map((a: Record<string, unknown>, index: number) => ({
            name: a.name,
            action_type: a.type,
            raw: a,
            resolved: {
              ...a,
              target: a.target ? 'v_orders' : undefined,
              source: a.type === 'write' ? 'v_orders' : a.source,
            },
            source: source([...base, 'actions', index]),
            origin: 'direct',
            editable: true,
          })),
        },
      ],
      dependencies: {
        action_graph: {
          nodes: raw.actions.map((a: Record<string, unknown>) => ({
            id: a.name,
            label: a.name,
            pipeline: raw.pipeline,
            flowgroup: raw.flowgroup,
          })),
          edges: [{ source: 'load', target: 'write' }],
        },
      },
    },
    context,
    1,
  );
  const documents = [{ path: 'pipelines/orders.yaml', text, version: 7, dirty: true }];
  snapshot.documents = documents;
  return {
    snapshot,
    documents,
    versions: { 'pipelines/orders.yaml': 7 },
    load: snapshot.flowgroups[0]!.actions[0]!,
    write: snapshot.flowgroups[0]!.actions[1]!,
  };
}
describe('native YAML mutations', () => {
  it('preserves nested comments and unknown fields on configured action', () => {
    const f = fixture();
    const changes = planMutation(
      f.snapshot,
      {
        kind: 'configure',
        actionId: f.load.id,
        values: {
          ...f.load.raw,
          source: { ...(f.load.raw.source as object), path: '/new' },
          custom: '😀',
        },
      },
      f.documents,
      f.versions,
    );
    expect(changes[0]!.text).toContain('/new # retain nested comment');
    expect(changes[0]!.text).toContain('😀');
  });
  it('rejects stale versions and stale graph instead of overwriting newer text', () => {
    const f = fixture();
    expect(() =>
      planMutation(f.snapshot, { kind: 'delete', actionId: f.load.id }, f.documents, {
        'pipelines/orders.yaml': 6,
      }),
    ).toThrow('document changed');
    expect(() =>
      planMutation(
        { ...f.snapshot, stale: true },
        { kind: 'delete', actionId: f.load.id },
        f.documents,
        f.versions,
      ),
    ).toThrow('Refresh the graph');
  });
  it('disconnects raw substitutions matched through resolved input', () => {
    const f = fixture();
    const changes = planMutation(
      f.snapshot,
      { kind: 'disconnect', sourceId: f.load.id, targetId: f.write.id, dataset: 'v_orders' },
      f.documents,
      f.versions,
    );
    expect(parseAllDocuments(changes[0]!.text)[0]!.toJS().actions[1].source).toBeUndefined();
  });
  it('duplicates with a unique output and rejects duplicate action names', () => {
    const f = fixture();
    const changes = planMutation(
      f.snapshot,
      { kind: 'duplicate', actionId: f.load.id, newName: 'second load' },
      f.documents,
      f.versions,
    );
    const raw = parseAllDocuments(changes[0]!.text)[0]!.toJS();
    expect(raw.actions[2].name).toBe('second load');
    expect(raw.actions[2].target).toBe('${view}_copy');
    expect(() =>
      planMutation(
        f.snapshot,
        { kind: 'duplicate', actionId: f.load.id, newName: 'write' },
        f.documents,
        f.versions,
      ),
    ).toThrow('already exists');
  });
  it('addresses mapping arrays inside the correct document and retains separators', () => {
    const f = fixture(
      'flowgroup: untouched\npipeline: bronze\nactions: []\n---\nflowgroups:\n  - flowgroup: orders\n    pipeline: bronze\n    actions:\n      - name: load\n        type: load\n        target: v_orders\n      - name: write\n        type: write\n        source: v_orders\n',
    );
    const changes = planMutation(
      f.snapshot,
      { kind: 'delete', actionId: f.write.id },
      f.documents,
      f.versions,
    );
    const docs = parseAllDocuments(changes[0]!.text);
    expect(docs).toHaveLength(2);
    expect(docs[0]!.toJS().flowgroup).toBe('untouched');
    expect(docs[1]!.toJS().flowgroups[0].actions).toHaveLength(1);
  });
});
