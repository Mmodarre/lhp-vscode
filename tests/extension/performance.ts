/** Opt-in read-only check against the repository's public performance example.
 * It never creates/saves documents or changes settings in the inspected project. */
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';

export async function run(): Promise<void> {
  const root = process.env.LHP_PERF_PROJECT;
  const python = process.env.LHP_TEST_PYTHON;
  assert.ok(root && python, 'Performance project and compatible Python are explicit');
  const extension = vscode.extensions.getExtension<ExtensionApi>('MEHDIMODARRESSI.lhp-vscode');
  assert.ok(extension);
  const api = await extension.activate();
  const id = vscode.Uri.file(root).toString();
  api.controller.projects.push({ root, summary: { id, name: 'performance', rootLabel: root } });
  await api.controller.context.workspaceState.update('lhp.interpreters', { [id]: python });
  await api.controller.context.workspaceState.update('lhp.environments', { [id]: 'dev' });
  api.controller.panel.show();
  const started = performance.now();
  await api.controller.selectProject(id);
  const snapshot = api.controller.snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.context.runtime.compatible, true, snapshot.context.runtime.message);
  assert.equal(snapshot.refreshState, 'ready', snapshot.refreshError);
  assert.equal(snapshot.stale, false);
  const actions = snapshot.flowgroups.reduce((sum, group) => sum + group.actions.length, 0);
  const edges = new Set(snapshot.flowgroups.flatMap((group) => group.edges.map((edge) => edge.id)))
    .size;
  assert.equal(snapshot.flowgroups.length, 4017);
  assert.equal(actions, 18766);
  assert.equal(edges, 17961);
  assert.equal(snapshot.flowgroupEdges.length, 3212);
  assert.ok(snapshot.documents.length > 2000, 'All authored files keep native document versions');
  assert.ok(snapshot.documents.every((document) => !('text' in document)));
  assert.ok(
    snapshot.pipelines.every((pipeline) =>
      pipeline.flowgroups.every((group) => !('actions' in group)),
    ),
  );
  const metrics = {
    flowgroups: snapshot.flowgroups.length,
    actions,
    edges,
    flowgroupEdges: snapshot.flowgroupEdges.length,
    documents: snapshot.documents.length,
    elapsedSeconds: (performance.now() - started) / 1000,
    webviewBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    hostRssBytes: process.memoryUsage().rss,
  };
  await writeFile(
    path.join(extension.extensionPath, '.tmp/performance-metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
  console.log('Read-only performance project verification:', JSON.stringify(metrics));
  api.controller.cancel();
}
