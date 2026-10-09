import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/bridgeClient';
import { normalizeSnapshot } from '../../src/snapshot';
import { record, items } from '../../src/catalog';
import { validationDiagnostics } from '../../src/validation';
import type { ProjectContext } from '../../src/shared/protocol';

const python = process.env.LHP_TEST_PYTHON;
if (process.env.CI && !python)
  throw new Error('CI requires LHP_TEST_PYTHON for actual adapter tests.');
describe.skipIf(!python)('real LHP DTO normalization', () => {
  it('uses actual schema/help/parameters and canonical dependency graph, with useful invalid diagnostics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lhp-adapter-'));
    const client = new BridgeClient(path.resolve('bridge/lhp_bridge.py'), () => undefined);
    const context: ProjectContext = {
      project: { id: 'project', name: 'test', rootLabel: root },
      environment: 'dev',
      environments: ['dev'],
      trusted: true,
      runtime: { interpreter: python!, compatible: true, capabilities: [] },
    };
    try {
      await mkdir(path.join(root, 'pipelines'));
      await mkdir(path.join(root, 'templates/nested'), { recursive: true });
      await mkdir(path.join(root, 'blueprints'));
      await writeFile(path.join(root, 'lhp.yaml'), 'name: adapter_test\nversion: "1.0"\n');
      await writeFile(
        path.join(root, 'pipelines/flow.yaml'),
        'pipeline: bronze\nflowgroup: source\nactions:\n  - name: load\n    type: load\n    source:\n      type: cloudfiles\n      path: /Volumes/main/input/*.json\n      format: json\n    target: v_orders\n---\npipeline: bronze\nflowgroup: consumer\nactions:\n  - name: sql\n    type: transform\n    transform_type: sql\n    source: v_orders\n    sql: SELECT * FROM v_orders\n    target: v_clean\n',
      );
      await writeFile(
        path.join(root, 'templates/nested/reader.yaml'),
        'name: reader\nparameters:\n  - name: input_path\n    type: string\n    required: true\nactions: []\n',
      );
      await writeFile(
        path.join(root, 'blueprints/spec.yaml'),
        'name: spec\nparameters:\n  - name: site_name\n    type: string\n    required: true\nflowgroups: []\n',
      );
      const raw = await client.call({
        operation: 'snapshot',
        interpreter: python!,
        projectRoot: root,
      });
      const snapshot = normalizeSnapshot(root, raw, context, 3);
      expect(snapshot.catalog.actions).toHaveLength(24);
      const cloudfiles = snapshot.catalog.actions.find(
        (a) => a.type === 'load' && a.subtype === 'cloudfiles',
      )!;
      expect(cloudfiles.defaults.source).toMatchObject({ type: 'cloudfiles', format: 'json' });
      expect(cloudfiles.fields.find((f) => f.name === 'source.path')?.description).toContain(
        'Auto Loader',
      );
      expect(cloudfiles.fields.find((f) => f.name === 'name')?.required).toBe(true);
      expect(snapshot.catalog.actions.filter((a) => a.type === 'test')).toHaveLength(9);
      expect(snapshot.catalog.templates[0]?.name).toBe('nested/reader');
      expect(snapshot.catalog.templates[0]?.fields[0]?.name).toBe('input_path');
      expect(snapshot.catalog.blueprints[0]?.fields[0]?.name).toBe('site_name');
      expect(snapshot.flowgroups.find((f) => f.name === 'consumer')?.source.documentIndex).toBe(1);
      const canonical = record(record(record(raw).dependencies).action_graph);
      const normalizedEdges = new Set(snapshot.flowgroups.flatMap((f) => f.edges).map((e) => e.id));
      expect(normalizedEdges.size).toBe(items(canonical.edges).length);
      expect(snapshot.flowgroupEdges).toHaveLength(1);
      const yaml = 'pipeline: bronze\nflowgroup: invalid\nactions: []\n';
      await writeFile(path.join(root, 'pipelines/flow.yaml'), yaml);
      const invalid = await client.call({
        operation: 'validate',
        interpreter: python!,
        projectRoot: root,
      });
      const issues = validationDiagnostics(invalid, snapshot, root);
      expect(issues[0]?.message).toContain('at least one action');
      expect(issues[0]?.source?.path).toBe('pipelines/flow.yaml');
    } finally {
      client.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
