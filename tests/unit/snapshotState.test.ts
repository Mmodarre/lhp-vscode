import { describe, expect, it } from 'vitest';
import { pendingSnapshot, failedSnapshot } from '../../src/snapshotState';
import { normalizeSnapshot } from '../../src/snapshot';
import type { ProjectContext } from '../../src/shared/protocol';

const context: ProjectContext = {
  project: { id: 'p', name: 'project', rootLabel: 'project' },
  environment: 'dev',
  environments: ['dev'],
  trusted: true,
  runtime: { interpreter: 'python', compatible: true, capabilities: [] },
};
describe('independent refresh state', () => {
  it('uses deterministic compact IDs scoped by pipeline and full YAML source address', () => {
    const source = {
      path: 'pipelines/instance.yaml',
      document_index: 1,
      yaml_path: ['flowgroups', 0],
    };
    const group = (pipeline: string) => ({
      pipeline,
      name: 'shared_name',
      source,
      raw: {},
      actions: [{ name: 'action', source, raw: {}, resolved: {} }],
    });
    const value = { flowgroups: [group('a'), group('b')] };
    const first = normalizeSnapshot('/project', value, context, 1);
    const repeated = normalizeSnapshot('/project', value, context, 2);
    expect(first.flowgroups.map((group) => group.id)).toEqual(
      repeated.flowgroups.map((group) => group.id),
    );
    expect(new Set(first.flowgroups.map((group) => group.id)).size).toBe(2);
    expect(
      new Set(first.flowgroups.flatMap((group) => group.actions.map((action) => action.id))).size,
    ).toBe(2);
    expect(first.flowgroups.every((group) => group.id.length === 43)).toBe(true);
    expect(first.flowgroups[0]?.source).toMatchObject({
      path: source.path,
      documentIndex: 1,
      yamlPath: source.yaml_path,
    });
  });
  it('replaces missing-runtime state before a transport failure without inventing source errors', () => {
    const unavailable = pendingSnapshot(
      undefined,
      {
        ...context,
        runtime: { ...context.runtime, compatible: false, message: 'Missing package' },
      },
      1,
    );
    expect(unavailable.stale).toBe(false);
    expect(unavailable.notices).toEqual([]);
    const pending = pendingSnapshot(unavailable, context, 2);
    expect(pending.context.runtime.compatible).toBe(true);
    const failed = failedSnapshot(pending, new Error('Transport budget exceeded'));
    expect(failed.refreshState).toBe('failed');
    expect(failed.refreshError).toContain('Transport');
    expect(failed.context.runtime.message).toBeUndefined();
    expect(failed.stale).toBe(false);
    expect(failed.diagnostics).toEqual([]);
    expect(failed.notices).toEqual([]);
  });
  it('retains complete same-context graph with a failure reason but never another environment', () => {
    const previous = normalizeSnapshot(
      '/project',
      {
        flowgroups: [
          { name: 'f', pipeline: 'p', source: { path: 'p.yaml' }, actions: [], raw: {} },
        ],
      },
      context,
      1,
    );
    const failed = failedSnapshot(
      pendingSnapshot(previous, context, 2),
      new Error('Refresh failed'),
    );
    expect(failed.flowgroups).toHaveLength(1);
    expect(failed.stale).toBe(true);
    expect(failed.pipelines[0]?.flowgroups[0]).not.toHaveProperty('raw');
    expect(failed.pipelines[0]?.flowgroups[0]).not.toHaveProperty('actions');
    expect(pendingSnapshot(previous, { ...context, environment: 'prod' }, 3).flowgroups).toEqual(
      [],
    );
  });
});
