import * as assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { HostMessage } from '../../src/shared/protocol';
import type { SidebarNode, SidebarRef } from '../../src/sidebarModel';

function ref(node: SidebarNode): SidebarRef {
  return {
    id: node.id,
    kind: node.kind,
    projectId: node.projectId,
    revision: node.revision,
  };
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
  assert.equal(sidebar.view.title, 'Projects', 'native LHP TreeView is registered');
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['openSource', 'openDesigner', 'selectProject'])
    assert.ok(commands.includes(`lhp.sidebar.${name}`), `${name} tree command is registered`);

  const [project] = sidebar.provider.getChildren();
  assert.ok(project, 'active project appears in native tree');
  assert.equal(project.projectId, snapshot.context.project.id);
  const projectItem = sidebar.provider.getTreeItem(project);
  assert.equal(projectItem.contextValue, 'lhp.project');
  assert.equal(projectItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  const pipeline = sidebar.provider
    .getChildren(project)
    .find((node) => node.kind === 'pipeline' && node.label === 'bronze');
  assert.ok(pipeline, 'pipeline appears on expansion');
  const groups = sidebar.provider.getChildren(pipeline);
  const second = groups.find((node) => node.label === 'document_second');
  assert.ok(second, 'second YAML document flowgroup appears in native tree');
  assert.equal(second.source?.documentIndex, 1);
  const actions = sidebar.provider.getChildren(second);
  const load = actions.find((node) => node.label === 'load_second');
  const write = actions.find((node) => node.label === 'write_second');
  assert.ok(load && write, 'actions load only when their flowgroup expands');
  assert.equal(sidebar.provider.getParent(load)?.id, second.id);
  assert.equal(sidebar.provider.getTreeItem(load).command?.command, 'lhp.sidebar.openSource');
  assert.deepEqual(sidebar.provider.getTreeItem(load).command?.arguments, [ref(load)]);

  const graphBeforeReveal = host.snapshot;
  const epochBeforeReveal = host.epoch;
  await vscode.commands.executeCommand('lhp.projects.focus');
  await sidebar.view.reveal(load, { select: true, focus: true, expand: 1 });
  assert.equal(host.snapshot, graphBeforeReveal, 'opening and expanding tree reuses cached graph');
  assert.equal(host.epoch, epochBeforeReveal, 'tree navigation does not start another refresh');

  const root = vscode.workspace.workspaceFolders![0]!.uri;
  const sourceUri = vscode.Uri.joinPath(root, 'pipelines/orders.yaml');
  await vscode.commands.executeCommand('lhp.sidebar.openSource', ref(second));
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.fsPath === sourceUri.fsPath,
  );
  assert.ok(editor, 'tree command opens authoritative YAML in native editor');
  assert.ok(editor.selection.active.line > 15, 'multi-document tree node reveals second document');
  assert.match(
    editor.document.lineAt(editor.selection.active.line).text,
    /pipeline: bronze|flowgroup: document_second/,
  );
  await assert.rejects(
    sidebar.openSource({ ...ref(second), revision: second.revision - 1 }),
    /stale/i,
  );
  await assert.rejects(sidebar.openSource({ ...ref(load), projectId: 'forged' }), /stale/i);

  // The latest rapid tree selection must survive first-panel startup, then be consumed once.
  host.panel.dispose();
  const originalPost = host.panel.post.bind(host.panel);
  const messages: HostMessage[] = [];
  host.panel.post = (message) => {
    messages.push(message);
    originalPost(message);
  };
  try {
    const first = sidebar.openDesigner(ref(load));
    const second = sidebar.openDesigner(ref(write));
    host.designerReady();
    await Promise.all([first, second]);
    const readyBootstrap = messages.filter((message) => message.type === 'bootstrap').at(-1);
    if (readyBootstrap?.type !== 'bootstrap') assert.fail('ready bootstrap was not sent');
    assert.equal(readyBootstrap.selection?.actionId, write.actionId);
    host.bootstrap();
    const nextBootstrap = messages.filter((message) => message.type === 'bootstrap').at(-1);
    if (nextBootstrap?.type !== 'bootstrap') assert.fail('next bootstrap was not sent');
    assert.equal(nextBootstrap.selection, undefined, 'navigation is not replayed on refresh');
  } finally {
    host.panel.post = originalPost;
  }

  // A second discovered project remains collapsed and cannot leak the active graph.
  const nestedRoot = path.join(root.fsPath, 'sidebar-other-project');
  await mkdir(nestedRoot, { recursive: true });
  await writeFile(path.join(nestedRoot, 'lhp.yaml'), 'name: sidebar_other\nversion: "1.0"\n');
  try {
    await eventually(
      async () =>
        (await vscode.workspace.findFiles('**/lhp.yaml')).some(
          (uri) => uri.fsPath === path.join(nestedRoot, 'lhp.yaml'),
        ),
      'nested LHP project to enter workspace index',
    );
    await host.discover();
    const inactive = sidebar.model.roots().find((node) => node.label === 'sidebar-other-project');
    assert.ok(inactive, 'second workspace project is discovered');
    assert.equal(inactive.childrenAvailable, false);
    assert.deepEqual(sidebar.provider.getChildren(inactive), []);
    assert.equal(
      sidebar.provider.getTreeItem(inactive).command?.command,
      'lhp.sidebar.selectProject',
    );
    assert.equal(host.project?.summary.id, project.projectId, 'active project remains selected');
  } finally {
    await rm(nestedRoot, { recursive: true, force: true });
    await host.discover();
  }
}
