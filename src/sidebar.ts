import * as vscode from 'vscode';
import type { Controller } from './controller';
import { openSource } from './documents';
import { SidebarModel, type SidebarNode } from './sidebarModel';

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<SidebarNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<SidebarNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(readonly model: SidebarModel) {}
  refresh(): void {
    this.changed.fire(undefined);
  }
  getChildren(node?: SidebarNode): SidebarNode[] {
    // VS Code can finish an old expansion after a project switch. Discard it.
    try {
      return this.model.children(node);
    } catch {
      return [];
    }
  }
  getParent(node: SidebarNode): SidebarNode | undefined {
    return this.model.getParent(node);
  }
  getTreeItem(node: SidebarNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.childrenAvailable
        ? node.kind === 'project'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    item.description = node.description;
    const inactive =
      node.kind === 'project' && node.projectId !== this.model.state.selectedProjectId;
    item.contextValue = inactive ? 'lhp.project.inactive' : `lhp.${node.kind}`;
    const icons = {
      project: 'project',
      pipeline: 'git-merge',
      flowgroup: 'symbol-namespace',
      action: 'symbol-method',
      file: 'file-code',
    };
    item.iconPath = new vscode.ThemeIcon(node.missing ? 'warning' : icons[node.kind]);
    item.tooltip =
      node.kind === 'project'
        ? this.model.state.projects.find((project) => project.id === node.projectId)?.rootLabel
        : [node.label, node.description, node.source?.path].filter(Boolean).join('\n');
    item.accessibilityInformation = {
      label: `${node.kind}: ${node.label}${node.description ? `, ${node.description}` : ''}`,
    };
    item.command = {
      command: inactive
        ? 'lhp.sidebar.selectProject'
        : node.source
          ? 'lhp.sidebar.openSource'
          : 'lhp.sidebar.openDesigner',
      title: inactive ? 'Select LHP Project' : node.source ? 'Open Source' : 'Open in Designer',
      arguments: [
        { id: node.id, projectId: node.projectId, revision: node.revision, kind: node.kind },
      ],
    };
    return item;
  }
  dispose(): void {
    this.changed.dispose();
  }
}

/** Native navigation only: one selected project and one shared controller. */
export class ProjectSidebar implements vscode.Disposable {
  readonly model = new SidebarModel();
  readonly provider = new ProjectTreeProvider(this.model);
  readonly view: vscode.TreeView<SidebarNode>;
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor(private readonly host: Controller) {
    this.view = vscode.window.createTreeView('lhp.projects', {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.subscriptions.push(host.onDidChangeState(() => this.update()));
    for (const [name, handler] of Object.entries({
      selectProject: (ref: unknown) => this.selectProject(ref),
      openSource: (ref: unknown) => this.openSource(ref),
      openDesigner: (ref: unknown) => this.openDesigner(ref),
    }))
      this.subscriptions.push(
        vscode.commands.registerCommand(`lhp.sidebar.${name}`, async (ref: unknown) => {
          try {
            await handler(ref);
          } catch (error) {
            host.report(error);
          }
        }),
      );
    this.update();
  }
  private update(): void {
    const { host } = this;
    const changed = this.model.update({
      projects: host.projects.map((project) => project.summary),
      selectedProjectId: host.project?.summary.id,
      snapshot: host.snapshot,
      trusted: vscode.workspace.isTrusted,
      revision: host.epoch,
      operation: host.status,
    });
    this.view.message = this.model.message;
    this.view.description = host.project
      ? `${host.project.summary.name} · ${host.environment(host.project)}`
      : undefined;
    if (changed) this.provider.refresh();
    void vscode.commands.executeCommand('setContext', 'lhp.hasProject', !!host.project);
    void vscode.commands.executeCommand('setContext', 'lhp.operationRunning', host.isOperating);
  }
  async selectProject(ref: unknown): Promise<void> {
    this.host.requireTrust();
    const node = this.model.resolve(ref);
    if (node.kind !== 'project') throw new Error('Select an LHP project.');
    if (node.projectId !== this.host.project?.summary.id)
      await this.host.selectProject(node.projectId);
  }
  async openSource(ref: unknown): Promise<void> {
    const project = this.host.requireProject();
    const node = this.model.resolve(ref);
    if (node.projectId !== project.summary.id || !node.source)
      throw new Error('Select a source in the active LHP project.');
    if (node.missing) throw new Error(`This related file does not exist: ${node.source.path}`);
    await openSource(
      project.root,
      this.host.snapshot?.stale ? { path: node.source.path } : node.source,
      false,
      vscode.ViewColumn.Active,
    );
  }
  async openDesigner(ref: unknown): Promise<void> {
    this.host.requireTrust();
    const node = this.model.resolve(ref);
    if (node.kind === 'project' && node.projectId !== this.host.project?.summary.id)
      await this.host.selectProject(node.projectId);
    if (node.projectId !== this.host.project?.summary.id)
      throw new Error('Select the active LHP project.');
    this.host.showSelection({
      projectId: node.projectId,
      revision: this.host.epoch,
      pipeline: node.pipeline,
      flowgroupId: node.flowgroupId,
      actionId: node.actionId,
    });
  }
  dispose(): void {
    for (const disposable of this.subscriptions) disposable.dispose();
    this.view.dispose();
    this.provider.dispose();
  }
}
