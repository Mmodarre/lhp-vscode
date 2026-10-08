import * as assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { HostMessage, ProjectDatasetIndex } from '../../src/shared/protocol';
import type { ItemRef, ViewItem } from '../../src/sidebarViewsModel';

function ref(node: ViewItem): ItemRef {
  return { id: node.id, kind: node.kind, projectId: node.projectId, revision: node.revision };
}
async function eventually(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

export async function runSidebarTests(api: ExtensionApi): Promise<void> {
  const host = api.controller;
  const sidebar = api.sidebar;
  const snapshot = host.snapshot;
  assert.ok(snapshot?.context.runtime.compatible, 'real project snapshot is ready for sidebar');
  const names = ['configuration', 'pipelines', 'resources', 'data', 'generated'] as const;
  for (const name of names)
    assert.ok(sidebar.views.get(name), `${name} native TreeView is registered`);
  assert.equal(sidebar.view.title, 'Pipelines');
  const commands = await vscode.commands.getCommands(true);
  for (const name of [
    'activate',
    'openSource',
    'openDesigner',
    'openResource',
    'findResource',
    'findConsumers',
    'inspect',
    'findAuthoringSource',
    'help',
  ])
    assert.ok(commands.includes(`lhp.sidebar.${name}`), `${name} command is registered`);

  const config = sidebar.providers.get('configuration')!.getChildren();
  assert.deepEqual(
    config.map((row) => row.label),
    ['Project', 'Environment', 'Python / LHP', 'Active pipeline config', 'Settings'],
  );
  const pipeline = sidebar.provider
    .getChildren()
    .find((row) => row.kind === 'pipeline' && row.label === 'bronze');
  assert.ok(pipeline, 'pipeline is visible in active project');
  assert.equal(sidebar.provider.getTreeItem(pipeline).command?.command, 'lhp.sidebar.activate');
  const groups = sidebar.provider.getChildren(pipeline);
  const second = groups.find((row) => row.label === 'document_second');
  assert.ok(second, 'second YAML document flowgroup appears');
  assert.equal(second.source?.documentIndex, 1);
  assert.equal(sidebar.provider.getTreeItem(second).command?.command, 'lhp.sidebar.activate');
  const actions = sidebar.provider.getChildren(second);
  const load = actions.find((row) => row.label === 'load_second');
  const write = actions.find((row) => row.label === 'write_second');
  assert.ok(load && write, 'actions load only when their flowgroup expands');
  assert.equal(sidebar.provider.getParent(load)?.id, second.id);
  assert.equal(sidebar.provider.getTreeItem(load).command?.command, 'lhp.sidebar.activate');
  assert.deepEqual(sidebar.provider.getTreeItem(load).command?.arguments, [ref(load)]);

  const graphBeforeReveal = host.snapshot;
  const epochBeforeReveal = host.epoch;
  await vscode.commands.executeCommand('lhp.pipelines.focus');
  await sidebar.view.reveal(load, { select: true, focus: true, expand: 1 });
  assert.equal(host.snapshot, graphBeforeReveal, 'tree expansion reuses cached graph');
  assert.equal(host.epoch, epochBeforeReveal, 'tree navigation starts no semantic scan');
  await eventually(async () => {
    const saved = host.context.workspaceState.get<
      Record<
        string,
        {
          pipelines?: { selected?: string };
        }
      >
    >('lhp.sidebarTreeState.v3');
    return saved?.[pipeline.projectId]?.pipelines?.selected === load.id;
  }, 'per-project native selection persistence');

  const root = vscode.workspace.workspaceFolders![0]!.uri;
  const sourceUri = vscode.Uri.joinPath(root, 'pipelines/orders.yaml');
  await sidebar.openSource(ref(second));
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.fsPath === sourceUri.fsPath,
  );
  assert.ok(editor, 'context source action opens authoritative YAML');
  assert.ok(editor.selection.active.line > 15, 'second document position is preserved');
  assert.match(
    editor.document.lineAt(editor.selection.active.line).text,
    /pipeline: bronze|flowgroup: document_second/,
  );
  await assert.rejects(
    sidebar.openSource({ ...ref(second), revision: second.revision - 1 }),
    /stale/i,
  );
  await assert.rejects(sidebar.openSource({ ...ref(load), projectId: 'forged' }), /stale/i);

  // Opening a pipeline focuses its flowgroup graph; a flowgroup focuses its action graph.
  const messages: HostMessage[] = [];
  const originalPost = host.panel.post.bind(host.panel);
  host.panel.post = (message) => {
    messages.push(message);
    originalPost(message);
  };
  try {
    await sidebar.openDesigner(ref(pipeline));
    assert.ok(
      messages.some(
        (message) =>
          (message.type === 'select' || message.type === 'bootstrap') &&
          message.selection?.pipeline === 'bronze',
      ),
    );
    await sidebar.openDesigner(ref(second));
    assert.ok(
      messages.some(
        (message) =>
          (message.type === 'select' || message.type === 'bootstrap') &&
          message.selection?.flowgroupId === second.flowgroupId,
      ),
    );
  } finally {
    host.panel.post = originalPost;
  }

  // Before the first designer ready handshake, the latest rapid native selection wins once.
  host.panel.dispose();
  const startupMessages: HostMessage[] = [];
  host.panel.post = (message) => {
    startupMessages.push(message);
    originalPost(message);
  };
  try {
    const first = sidebar.openDesigner(ref(load));
    const next = sidebar.openDesigner(ref(write));
    host.designerReady();
    await Promise.all([first, next]);
    const ready = startupMessages.filter((message) => message.type === 'bootstrap').at(-1);
    if (ready?.type !== 'bootstrap') assert.fail('first designer bootstrap missing');
    assert.equal(ready.selection?.actionId, write.actionId);
    host.bootstrap();
    const replay = startupMessages.filter((message) => message.type === 'bootstrap').at(-1);
    if (replay?.type !== 'bootstrap') assert.fail('second designer bootstrap missing');
    assert.equal(replay.selection, undefined, 'selection is consumed exactly once');
  } finally {
    host.panel.post = originalPost;
  }

  // A second discovered root never borrows the first project's graph or resource inventory.
  const nestedRoot = path.join(root.fsPath, 'sidebar-other-project');
  await mkdir(nestedRoot, { recursive: true });
  await writeFile(path.join(nestedRoot, 'lhp.yaml'), 'name: sidebar_other\nversion: "1.0"\n');
  try {
    await eventually(
      async () =>
        (await vscode.workspace.findFiles('**/lhp.yaml')).some(
          (uri) => uri.fsPath === path.join(nestedRoot, 'lhp.yaml'),
        ),
      'nested LHP project discovery',
    );
    await host.discover();
    assert.ok(host.projects.some((project) => project.root === nestedRoot));
    assert.equal(host.project?.summary.id, pipeline.projectId, 'selected project remains active');
    assert.equal(
      sidebar.model.roots('pipelines').some((row) => row.projectId !== pipeline.projectId),
      false,
    );
  } finally {
    await rm(nestedRoot, { recursive: true, force: true });
    await host.discover();
  }

  // A cached lineage address can point at a different action after YAML is
  // reordered. Stale relations still open the containing file at its start.
  const beforeLineage = sidebar.model.state;
  const semantic = beforeLineage.snapshot;
  assert.ok(semantic);
  const oldAddress = {
    path: 'pipelines/orders.yaml',
    documentIndex: 1,
    yamlPath: ['actions', 1] as (string | number)[],
  };
  const lineage: ProjectDatasetIndex = {
    projectId: semantic.context.project.id,
    revision: semantic.revision,
    environment: semantic.context.environment,
    stale: false,
    warnings: [],
    edges: [],
    datasets: [
      {
        id: 'stale-source-test',
        name: 'main.bronze.second',
        kind: 'table',
        producers: [{ label: 'write_second', source: oldAddress }],
        consumers: [],
        upstream: [],
        downstream: [],
      },
    ],
  };
  const relation = () => {
    const data = sidebar.providers.get('data')!;
    const declared = data.getChildren()[0]!;
    return data.getChildren(data.getChildren(declared)[0]!)[0]!;
  };
  try {
    sidebar.model.update({ ...beforeLineage, datasets: lineage });
    const currentRelation = relation();
    assert.equal(currentRelation.stale, false);
    await sidebar.openSource(ref(currentRelation));
    const currentEditor = vscode.window.activeTextEditor;
    assert.ok(currentEditor);
    assert.equal(currentEditor.document.uri.fsPath, sourceUri.fsPath);
    assert.ok(currentEditor.selection.active.line > 15);
    sidebar.model.update({ ...beforeLineage, datasets: { ...lineage, stale: true } });
    const staleRelation = relation();
    assert.equal(staleRelation.stale, true);
    await sidebar.openSource(ref(staleRelation));
    const staleEditor = vscode.window.activeTextEditor;
    assert.ok(staleEditor);
    assert.equal(staleEditor.document.uri.fsPath, sourceUri.fsPath);
    assert.equal(staleEditor.selection.active.line, 0);
  } finally {
    sidebar.model.update(beforeLineage);
  }

  // Generated output exposes provenance navigation only when generation recorded
  // a verified authoring source. Existing artifacts cannot be guessed from names.
  const previous = sidebar.model.state;
  const inventory = previous.resourceIndex;
  assert.ok(inventory);
  const oldOutput = {
    id: 'old-generated-output',
    path: 'generated/dev/old.py',
    name: 'old.py',
    source: { path: 'generated/dev/old.py' },
    kind: 'generated' as const,
    generatedKind: 'source' as const,
    environment: 'dev',
    exists: true,
    registered: false,
    consumers: [],
  };
  const verifiedOutput = {
    ...oldOutput,
    id: 'verified-generated-output',
    path: 'generated/dev/verified.py',
    name: 'verified.py',
    source: { path: 'generated/dev/verified.py' },
    authoringSources: [{ label: 'bronze / orders', source: { path: 'pipelines/orders.yaml' } }],
  };
  const bundleOutput = {
    ...verifiedOutput,
    id: 'verified-generated-bundle',
    path: 'resources/lhp/orders.yml',
    name: 'orders.yml',
    source: { path: 'resources/lhp/orders.yml' },
    generatedKind: 'bundle' as const,
    environment: undefined,
  };
  const wheelOutput = {
    ...oldOutput,
    id: 'generated-wheel',
    path: 'generated/dev/orders.whl',
    name: 'orders.whl',
    source: { path: 'generated/dev/orders.whl' },
    generatedKind: 'wheel' as const,
  };
  const otherEnvironment = {
    ...oldOutput,
    id: 'other-environment-source',
    path: 'generated/prod/orders.py',
    name: 'orders.py',
    source: { path: 'generated/prod/orders.py' },
    environment: 'prod',
  };
  try {
    sidebar.model.update({
      ...previous,
      resourceIndex: {
        ...inventory,
        files: [
          ...inventory.files,
          oldOutput,
          verifiedOutput,
          bundleOutput,
          wheelOutput,
          otherEnvironment,
        ],
      },
    });
    const generated = sidebar.providers.get('generated')!;
    const files = generated
      .getChildren()
      .flatMap((environment) =>
        generated.getChildren(environment).flatMap((group) => generated.getChildren(group)),
      );
    const oldNode = files.find((row) => row.label === 'old.py');
    const verifiedNode = files.find((row) => row.label === 'verified.py');
    const bundleNode = files.find((row) => row.label === 'orders.yml');
    const wheelNode = files.find((row) => row.label === 'orders.whl');
    const foreignNode = files.find((row) => row.label === 'orders.py');
    assert.ok(oldNode && verifiedNode && bundleNode && wheelNode && foreignNode);
    assert.equal(generated.getTreeItem(oldNode).contextValue, 'lhp.resource.generated.compare');
    assert.equal(
      generated.getTreeItem(verifiedNode).contextValue,
      'lhp.resource.generated.compare.authored',
    );
    assert.equal(
      generated.getTreeItem(bundleNode).contextValue,
      'lhp.resource.generated.authored',
      'verified authoring navigation is independent of Compare',
    );
    assert.equal(generated.getTreeItem(wheelNode).contextValue, 'lhp.resource.generated');
    assert.equal(generated.getTreeItem(foreignNode).contextValue, 'lhp.resource.generated');
    await assert.rejects(sidebar.compareGenerated(ref(bundleNode)), /active environment/i);
    await assert.rejects(sidebar.compareGenerated(ref(wheelNode)), /active environment/i);
    await assert.rejects(sidebar.compareGenerated(ref(foreignNode)), /active environment/i);
    await assert.rejects(
      sidebar.findAuthoringSource(ref(oldNode)),
      /no verified authoring source/i,
    );
  } finally {
    sidebar.model.update(previous);
  }
}
