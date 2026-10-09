import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import { createBundlePipelineConfig } from '../../src/onboarding';
import { generateSavedProject } from '../../src/projectOperations';
import { snapshotDocuments } from '../../src/documents';
import type { ActionMutation, ProjectSnapshot, WebviewRequest } from '../../src/shared/protocol';
import { runSidebarTests } from './sidebar';
import { runLanguageTests } from './language';
import { runResourceGenerationTests, runResourceTests } from './resources';
import { runSandboxTests } from './sandbox';

let nextRequestId = 0;
const requestId = (): string => `extension-test-${++nextRequestId}`;
const documentVersions = (snapshot: ProjectSnapshot): Record<string, number> =>
  Object.fromEntries(snapshot.documents.map((document) => [document.path, document.version]));
function current(api: ExtensionApi): ProjectSnapshot {
  const snapshot = api.controller.snapshot;
  assert.ok(snapshot, 'project snapshot is available');
  return snapshot;
}
function context(snapshot: ProjectSnapshot): WebviewRequest['context'] {
  return { projectId: snapshot.context.project.id, revision: snapshot.revision };
}
async function eventually(check: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
async function mutate(
  api: ExtensionApi,
  mutation: ActionMutation,
  versions?: Record<string, number>,
): Promise<void> {
  const snapshot = current(api);
  await api.controller.receive({
    type: 'mutate',
    requestId: requestId(),
    context: context(snapshot),
    projectId: snapshot.context.project.id,
    documentVersions: versions ?? documentVersions(snapshot),
    mutation,
  });
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<ExtensionApi>('MEHDIMODARRESSI.lhp-vscode');
  assert.ok(extension, 'extension installed');
  const api = await extension.activate();
  assert.ok(
    vscode.extensions.getExtension('redhat.vscode-yaml')?.isActive,
    'real YAML extension active',
  );
  assert.ok((await vscode.commands.getCommands(true)).includes('lhp.openDesigner'));
  await api.controller.refresh();
  assert.ok(current(api).context.runtime.compatible, current(api).context.runtime.message);
  assert.ok(current(api).flowgroups.length > 0);
  await runSidebarTests(api);
  const root = vscode.workspace.workspaceFolders![0]!.uri;
  const ordersUri = vscode.Uri.joinPath(root, 'pipelines/orders.yaml');
  assert.ok(
    api.languages
      .schemaFor(vscode.Uri.joinPath(root, 'lhp.yaml').toString())
      .startsWith('lhp-schema:'),
  );

  // A second YAML document must open at its own flowgroup, not at document zero.
  const second = current(api).flowgroups.find((flowgroup) => flowgroup.name === 'document_second');
  assert.ok(second, 'second flowgroup discovered from one multi-document YAML file');
  assert.equal(second.source.documentIndex, 1);
  // Sidebar tests intentionally reveal the same document in another group.
  // Isolate this source-navigation assertion from those earlier editor tabs.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await api.controller.receive({
    type: 'openSource',
    requestId: requestId(),
    context: context(current(api)),
    source: second.source,
  });
  const secondEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.fsPath === ordersUri.fsPath,
  );
  assert.ok(secondEditor, 'native YAML editor opened beside designer');
  assert.ok(secondEditor.selection.active.line > 15, 'selection reveals second YAML document');
  assert.match(
    secondEditor.document.lineAt(secondEditor.selection.active.line).text,
    /pipeline: bronze|flowgroup: document_second/,
  );

  await api.controller.operate('validate');
  assert.equal(
    current(api).diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    0,
  );
  await api.controller.operate('preview');
  const preview = vscode.workspace.textDocuments.find(
    (document) => document.uri.scheme === 'lhp-preview',
  );
  assert.ok(preview, 'preview opens a read-only native document');

  // A native editor change expires the preview, even before the next graph refresh.
  const source = await vscode.workspace.openTextDocument(ordersUri);
  const invalidate = new vscode.WorkspaceEdit();
  invalidate.insert(ordersUri, new vscode.Position(0, 0), '# native edit expires preview\n');
  assert.ok(await vscode.workspace.applyEdit(invalidate));
  await assert.rejects(
    api.controller.previews.show(preview.uri.path.replace(/^\/+/, '')),
    /stale/i,
  );
  const revisionAfterEdit = current(api).revision;
  await eventually(
    () => !current(api).stale && current(api).revision >= revisionAfterEdit,
    'fresh graph after native source edit',
  );

  // The webview request carries document versions; stale versions and context are rejected without writing.
  const load = current(api)
    .flowgroups.flatMap((flowgroup) => flowgroup.actions)
    .find((action) => action.name === 'load_orders');
  assert.ok(load, 'editable direct action discovered');
  const planned: ActionMutation = {
    kind: 'configure',
    actionId: load.id,
    values: { ...load.raw, description: 'edited through graph' },
  };
  const oldText = source.getText();
  const staleVersions = {
    ...documentVersions(current(api)),
    [load.source.path]: source.version - 1,
  };
  await assert.rejects(mutate(api, planned, staleVersions), /document changed/i);
  assert.equal(source.getText(), oldText, 'stale version did not alter native YAML');
  const staleContext = {
    projectId: current(api).context.project.id,
    revision: current(api).revision - 1,
  };
  await assert.rejects(
    api.controller.receive({
      type: 'mutate',
      requestId: requestId(),
      context: staleContext,
      projectId: staleContext.projectId,
      documentVersions: documentVersions(current(api)),
      mutation: planned,
    }),
    /stale/i,
  );
  assert.equal(source.getText(), oldText, 'stale project revision did not alter native YAML');

  // The actual graph mutation is a WorkspaceEdit on TextDocument and participates in native undo/redo.
  await mutate(api, planned);
  assert.ok(source.isDirty, 'graph edit leaves the authoritative native document unsaved');
  assert.match(source.getText(), /edited through graph/);
  await vscode.window.showTextDocument(source, { viewColumn: vscode.ViewColumn.Beside });
  await vscode.commands.executeCommand('undo');
  await eventually(
    () => !source.getText().includes('edited through graph'),
    'native undo of graph edit',
  );
  await vscode.commands.executeCommand('redo');
  await eventually(
    () => source.getText().includes('edited through graph'),
    'native redo of graph edit',
  );

  // Blueprint invocation parameters are editable on the instance; expanded actions remain definition-owned.
  await eventually(() => !current(api).stale, 'fresh graph after undo and redo');
  const blueprint = current(api).flowgroups.find(
    (flowgroup) => flowgroup.origin.kind === 'blueprint',
  );
  assert.ok(blueprint, 'blueprint instance expanded from real LHP catalogue');
  assert.ok(blueprint.instanceEditable, 'invocation parameters may be edited');
  assert.equal(blueprint.source.path, 'pipelines/blueprint.yaml');
  const raw = blueprint.raw;
  assert.equal(raw.use_blueprint, 'simple_blueprint');
  await mutate(api, {
    kind: 'configureFlowgroup',
    flowgroupId: blueprint.id,
    values: { ...raw, parameters: { site_name: 'beta' } },
  });
  const blueprintDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, 'pipelines/blueprint.yaml'),
  );
  assert.ok(blueprintDocument.isDirty);
  assert.match(blueprintDocument.getText(), /site_name: beta/);
  await eventually(
    () => current(api).flowgroups.some((flowgroup) => flowgroup.name === 'beta_sample'),
    'recomputed blueprint graph',
  );

  // Exercise the production post-confirm path: save native drafts, then generate
  // complete source and Databricks bundle resources without a mocked controller.
  await assert.rejects(generateSavedProject(api.controller), /Save project documents/i);
  assert.ok(await source.save());
  assert.ok(await blueprintDocument.save());
  await api.controller.refresh();
  await eventually(() => !current(api).stale, 'fresh saved project before generation');
  await generateSavedProject(api.controller);
  const generated = await vscode.workspace.fs.readDirectory(
    vscode.Uri.joinPath(root, 'generated/dev'),
  );
  assert.ok(generated.length > 0, 'full generation wrote source for selected environment');
  const resources = await vscode.workspace.fs.readDirectory(
    vscode.Uri.joinPath(root, 'resources/lhp'),
  );
  assert.ok(
    resources.some(([filename]) => filename.endsWith('.yml')),
    'bundle resources were generated',
  );
  await runResourceGenerationTests(api);

  // The new-project guide writes a real native YAML config and never replaces one.
  const guidedRoot = await mkdtemp(path.join(tmpdir(), 'lhp-guided-config-'));
  try {
    await mkdir(path.join(guidedRoot, 'config'));
    await createBundlePipelineConfig(guidedRoot, 'main', 'bronze');
    const guidedConfig = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(guidedRoot, 'config/pipeline_config.yaml')),
    );
    assert.match(guidedConfig.getText(), /catalog: main/);
    assert.match(guidedConfig.getText(), /schema: bronze/);
    await createBundlePipelineConfig(guidedRoot, 'other', 'other');
    assert.doesNotMatch(guidedConfig.getText(), /catalog: other/);
    assert.ok(await guidedConfig.save());
  } finally {
    await rm(guidedRoot, { recursive: true, force: true });
  }

  // Filesystem watcher rediscovery must track sibling projects without
  // switching the active graph away from the selected original root.
  const nestedRoot = vscode.Uri.joinPath(root, 'nested-project');
  const nestedMarker = vscode.Uri.joinPath(nestedRoot, 'lhp.yaml');
  const selectedRoot = api.controller.project?.root;
  await vscode.workspace.fs.createDirectory(nestedRoot);
  try {
    await vscode.workspace.fs.writeFile(
      nestedMarker,
      Buffer.from('name: nested_host_test\nversion: "1.0"\n'),
    );
    await eventually(
      () => api.controller.projects.some((project) => project.summary.id === nestedRoot.toString()),
      'new nested LHP project discovery',
    );
    assert.equal(api.controller.project?.root, selectedRoot);
    await vscode.workspace.fs.delete(nestedMarker);
    await eventually(
      () =>
        !api.controller.projects.some((project) => project.summary.id === nestedRoot.toString()),
      'deleted nested LHP project removal',
    );
    assert.equal(api.controller.project?.root, selectedRoot);
  } finally {
    try {
      await vscode.workspace.fs.delete(nestedRoot, { recursive: true });
    } catch {
      /* The test's temporary nested folder may already have been removed. */
    }
  }

  // Cancelled and superseded refreshes retain valid runtime/graph information,
  // leave loading state, and permit a clean retry after the old request settles.
  await api.controller.refresh();
  const documentLoading = new AbortController();
  const loadingDocuments = snapshotDocuments(
    api.controller.project!.root,
    current(api),
    documentLoading.signal,
  );
  documentLoading.abort();
  await assert.rejects(loadingDocuments, /abort/i);
  const bridgeCall = api.controller.bridge.call.bind(api.controller.bridge);
  for (const supersede of [false, true]) {
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let blocked = false;
    let stopped = false;
    api.controller.bridge.call = async (call) => {
      if (call.operation === 'snapshot' && !blocked) {
        blocked = true;
        started();
        await new Promise<void>((_resolve, reject) => {
          const stop = () => {
            stopped = true;
            reject(new Error('Cancelled test snapshot'));
          };
          if (call.signal?.aborted) stop();
          else call.signal?.addEventListener('abort', stop, { once: true });
        });
      }
      if (call.operation === 'snapshot')
        assert.ok(stopped, 'superseding work waits for cancelled work');
      return bridgeCall(call);
    };
    try {
      const refreshing = api.controller.refresh();
      await pending;
      if (supersede) await Promise.all([refreshing, api.controller.refresh()]);
      else {
        api.controller.cancel();
        await refreshing;
        assert.equal(current(api).refreshState, 'failed');
        assert.match(current(api).refreshError ?? '', /cancelled/i);
        assert.equal(current(api).context.runtime.compatible, true);
        assert.ok(current(api).flowgroups.length > 0);
      }
    } finally {
      api.controller.bridge.call = bridgeCall;
    }
    await api.controller.refresh();
    assert.equal(current(api).refreshState, 'ready');
  }
  await runResourceTests(api);
  await runLanguageTests(api);
  await runSandboxTests(api);
}
