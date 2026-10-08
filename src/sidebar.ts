import * as vscode from 'vscode';
import type { Controller } from './controller';
import { openSource } from './documents';
import { containedPath } from './paths';
import type { InspectionKind } from './shared/projectModel';
import { SidebarViewsModel, type ItemRef, type ViewItem, type ViewName } from './sidebarViewsModel';

export const SIDEBAR_VIEWS: readonly ViewName[] = [
  'configuration',
  'pipelines',
  'resources',
  'data',
  'generated',
];
type SavedViewState = { expanded: string[]; selected?: string };
type SavedTreeState = Record<string, Partial<Record<ViewName, SavedViewState>>>;
const ICONS: Record<string, string> = {
  config: 'settings-gear',
  pipeline: 'git-merge',
  flowgroup: 'symbol-namespace',
  action: 'symbol-method',
  category: 'folder',
  resource: 'file-code',
  dataset: 'database',
  relation: 'link',
  notice: 'info',
};
function ref(node: ViewItem): ItemRef {
  return { id: node.id, kind: node.kind, projectId: node.projectId, revision: node.revision };
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<ViewItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ViewItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    readonly model: SidebarViewsModel,
    readonly view: ViewName,
  ) {}
  refresh(): void {
    this.changed.fire(undefined);
  }
  getChildren(item?: ViewItem): ViewItem[] {
    try {
      return item ? this.model.children(item) : this.model.roots(this.view);
    } catch {
      return [];
    } // VS Code may finish a stale expansion after switching projects.
  }
  getParent(item: ViewItem): ViewItem | undefined {
    return this.model.parent(item);
  }
  getTreeItem(node: ViewItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.expandable
        ? node.kind === 'config' && node.label === 'Settings'
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    item.description = node.description;
    const resource = this.model.resource(node);
    const canCompare =
      resource?.kind === 'generated' &&
      resource.generatedKind === 'source' &&
      resource.exists &&
      resource.environment === this.model.state.environment;
    item.contextValue =
      node.kind === 'config'
        ? `lhp.config.${node.group}${node.source && node.group === 'pipelineConfig' ? '.selected' : ''}${resource ? '.catalogued' : ''}`
        : `lhp.${node.kind}${resource ? `.${resource.kind}${resource.configurationKind ? `.${resource.configurationKind}` : ''}${canCompare ? '.compare' : ''}${resource.kind === 'generated' && resource.authoringSources?.length ? '.authored' : ''}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(node.missing ? 'warning' : (ICONS[node.kind] ?? 'file'));
    const runtime =
      node.kind === 'config' && node.group === 'runtime' ? this.model.state.runtime : undefined;
    const projectPath =
      node.kind === 'config' && node.group === 'project'
        ? this.model.state.projects.find((project) => project.id === node.projectId)?.rootLabel
        : undefined;
    item.tooltip = [
      node.label,
      node.description,
      node.source?.path,
      projectPath,
      runtime?.interpreter,
      runtime?.pythonVersion && `Python ${runtime.pythonVersion}`,
      runtime?.lhpVersion && `LHP ${runtime.lhpVersion}`,
      runtime?.capabilities?.length && `Capabilities: ${runtime.capabilities.join(', ')}`,
      node.stale ? 'Last valid graph; refresh after fixing source errors.' : undefined,
    ]
      .filter(Boolean)
      .join('\n');
    item.accessibilityInformation = {
      label: `${node.label}${node.description ? `, ${node.description}` : ''}`,
    };
    if (node.intent !== 'none')
      item.command = {
        command: 'lhp.sidebar.activate',
        title: 'Open',
        arguments: [ref(node)],
      };
    return item;
  }
  dispose(): void {
    this.changed.dispose();
  }
}

/** Five native views over one selected project. All semantic work stays host-owned. */
export class ProjectSidebar implements vscode.Disposable {
  readonly model = new SidebarViewsModel();
  readonly providers = new Map<ViewName, ProjectTreeProvider>();
  readonly views = new Map<ViewName, vscode.TreeView<ViewItem>>();
  /** Compatibility alias for native tests and extension integrations. */
  get provider(): ProjectTreeProvider {
    return this.providers.get('pipelines')!;
  }
  get view(): vscode.TreeView<ViewItem> {
    return this.views.get('pipelines')!;
  }
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly saved: SavedTreeState;
  private lastProjectId?: string;
  constructor(private readonly host: Controller) {
    this.saved = host.context.workspaceState.get<SavedTreeState>('lhp.sidebarTreeState.v3', {});
    for (const name of SIDEBAR_VIEWS) {
      const provider = new ProjectTreeProvider(this.model, name);
      const tree = vscode.window.createTreeView(`lhp.${name}`, {
        treeDataProvider: provider,
        showCollapseAll: true,
      });
      this.providers.set(name, provider);
      this.views.set(name, tree);
      this.subscriptions.push(
        tree.onDidExpandElement(({ element }) => this.remember(element, true)),
        tree.onDidCollapseElement(({ element }) => this.remember(element, false)),
        tree.onDidChangeSelection(({ selection }) => {
          if (selection[0]) this.rememberSelection(selection[0]);
        }),
        tree.onDidChangeVisibility(({ visible }) => {
          if (visible) void this.restore(name);
        }),
      );
    }
    this.subscriptions.push(host.onDidChangeState(() => this.update()));
    const handlers: Record<string, (argument?: unknown) => Promise<void>> = {
      activate: (argument) => this.activate(argument),
      openSource: (argument) => this.openSource(argument),
      openDesigner: (argument) => this.openDesigner(argument),
      openResource: (argument) => this.openResource(argument),
      selectProject: (argument) => this.selectProject(argument),
      inspect: (argument) => this.inspect(argument),
      findConsumers: (argument) => this.findConsumers(argument),
      revealResource: (argument) => this.revealResource(argument),
      compareGenerated: (argument) => this.compareGenerated(argument),
      findAuthoringSource: (argument) => this.findAuthoringSource(argument),
      findResource: async () => this.host.findResource(),
      help: async () => this.host.showHelp(),
      createBronze: async () => this.startGuide('bronze'),
      createFlowgroup: async () => this.startGuide('flowgroup'),
      createPipeline: async () => this.createPipeline(),
      createTemplateInstance: (argument) => this.instanceGuide('template', argument),
      createBlueprintInstance: (argument) => this.instanceGuide('blueprint', argument),
      selectPipelineConfig: async () => this.host.selectPipelineConfig(),
      openEnvironmentSource: async () => this.openEnvironmentSource(),
      revealProject: async () => this.revealProject(),
      refreshResources: async () => this.host.refreshResources(),
      loadData: async () => this.host.loadData(),
    };
    for (const [name, handler] of Object.entries(handlers))
      this.subscriptions.push(
        vscode.commands.registerCommand(`lhp.sidebar.${name}`, async (argument?: unknown) => {
          try {
            await handler(argument);
          } catch (error) {
            this.host.report(error);
          }
        }),
      );
    this.update();
  }
  private update(): void {
    const project = this.host.project;
    const switched = this.lastProjectId !== project?.summary.id;
    const needsResourceRestore = !this.model.state.resourceIndex && !!this.host.resourceIndex;
    this.lastProjectId = project?.summary.id;
    const changed = this.model.update({
      projects: this.host.projects.map((entry) => entry.summary),
      selectedProjectId: project?.summary.id,
      snapshot: this.host.snapshot,
      resourceIndex: this.host.resourceIndex,
      catalog: this.host.catalog,
      datasets: this.host.datasets,
      runtime: this.host.runtime,
      environment: project ? this.host.environment(project) : undefined,
      activePipelineConfig: project ? this.host.activePipelineConfig(project) : undefined,
      trusted: vscode.workspace.isTrusted,
      revision: this.host.epoch,
    });
    for (const name of SIDEBAR_VIEWS) {
      const view = this.views.get(name)!;
      view.message = this.model.message(name);
      view.description = project
        ? `${project.summary.name} · ${this.host.environment(project)}`
        : undefined;
      if (changed) this.providers.get(name)!.refresh();
    }
    if (switched || needsResourceRestore)
      for (const name of SIDEBAR_VIEWS) if (this.views.get(name)?.visible) void this.restore(name);
    void vscode.commands.executeCommand('setContext', 'lhp.hasProject', !!project);
    void vscode.commands.executeCommand(
      'setContext',
      'lhp.operationRunning',
      this.host.isOperating,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lhp.runtimeCompatible',
      !!this.host.runtime?.compatible,
    );
  }
  private save(): void {
    void this.host.context.workspaceState.update('lhp.sidebarTreeState.v3', this.saved);
  }
  private savedView(item: ViewItem): SavedViewState {
    const project = (this.saved[item.projectId] ??= {});
    return (project[item.view] ??= { expanded: [] });
  }
  private remember(item: ViewItem, expanded: boolean): void {
    const view = this.savedView(item);
    view.expanded = view.expanded.filter((id) => id !== item.id);
    if (expanded) view.expanded.push(item.id);
    if (view.expanded.length > 80) view.expanded = view.expanded.slice(-80);
    this.save();
  }
  private rememberSelection(item: ViewItem): void {
    this.savedView(item).selected = item.id;
    this.save();
  }
  private async restore(name: ViewName): Promise<void> {
    const projectId = this.host.project?.summary.id;
    const saved = projectId ? this.saved[projectId]?.[name] : undefined;
    const tree = this.views.get(name);
    if (!saved || !tree?.visible) return;
    const available = new Map(this.model.roots(name).map((item) => [item.id, item]));
    const pending = new Set(saved.expanded);
    for (let pass = 0; pass < 4 && pending.size; pass++) {
      let progress = false;
      for (const id of [...pending]) {
        const item = available.get(id);
        if (!item || !item.expandable) continue;
        if (this.host.project?.summary.id !== projectId) return;
        try {
          await tree.reveal(item, { expand: true, focus: false, select: false });
          for (const child of this.model.children(item)) available.set(child.id, child);
        } catch {
          /* The view may have been hidden during restoration. */
        }
        pending.delete(id);
        progress = true;
      }
      if (!progress) break;
    }
    const selected = saved.selected ? available.get(saved.selected) : undefined;
    if (selected && this.host.project?.summary.id === projectId) {
      try {
        await tree.reveal(selected, { select: true, focus: false });
      } catch {
        /* The selection may no longer exist after source changes. */
      }
    }
  }
  private current(value: unknown): ViewItem {
    const node = this.model.resolve(value);
    if (node.projectId !== this.host.project?.summary.id)
      throw new Error('Select an item in the active LHP project.');
    return node;
  }
  async activate(value: unknown): Promise<void> {
    const node = this.current(value);
    if (node.intent === 'project') await this.host.selectProject();
    else if (node.intent === 'environment') await this.host.selectEnvironment();
    else if (node.intent === 'interpreter') await this.host.interpreter();
    else if (node.intent === 'pipelineConfig') {
      if (node.source) await this.openSource(value);
      else await this.host.selectPipelineConfig();
    } else if (node.intent === 'settings')
      await vscode.commands.executeCommand('workbench.action.openSettings', 'lhp');
    else if (node.intent === 'source') await this.openSource(value);
    else if (node.intent === 'resource') await this.openResource(value);
    else if (node.intent === 'designer') await this.openDesigner(value);
    else if (node.intent === 'loadData') await this.host.loadData();
  }
  async selectProject(value: unknown): Promise<void> {
    const node = this.model.resolve(value);
    if (node.kind !== 'config') throw new Error('Select the Project row.');
    await this.host.selectProject();
  }
  async openSource(value: unknown): Promise<void> {
    const project = this.host.readProject(); // Contained read-only navigation works without trust.
    const node = this.current(value);
    if (!node.source) throw new Error('This item has no local source location.');
    if (node.missing) throw new Error(`This related file does not exist: ${node.source.path}`);
    await openSource(
      project.root,
      node.stale ? { path: node.source.path } : node.source,
      false,
      vscode.ViewColumn.Active,
    );
  }
  async openResource(value: unknown): Promise<void> {
    const node = this.current(value);
    if (node.resourceId) await this.host.openResource(node.resourceId);
    else await this.openSource(value);
  }
  async openDesigner(value: unknown): Promise<void> {
    this.host.requireTrust();
    const node = this.current(value);
    this.host.showSelection({
      projectId: node.projectId,
      revision: this.host.epoch,
      pipeline: node.pipeline,
      flowgroupId: node.flowgroupId,
      actionId: node.actionId,
      view:
        node.kind === 'dataset'
          ? 'dataset'
          : node.kind === 'flowgroup'
            ? 'flowgroup'
            : node.kind === 'pipeline'
              ? 'pipeline'
              : undefined,
      datasetId: node.datasetId,
    });
  }
  private resourceNode(value: unknown): { node: ViewItem; id: string } {
    const node = this.current(value);
    if (!node.resourceId) throw new Error('Select a project resource.');
    return { node, id: node.resourceId };
  }
  async inspect(value: unknown): Promise<void> {
    const { node, id } = this.resourceNode(value);
    const resource = this.model.resource(node)!;
    let kind: InspectionKind | undefined;
    if (resource.kind === 'template') kind = 'template';
    else if (resource.kind === 'preset') kind = 'preset';
    else if (resource.configurationKind === 'pipeline') kind = 'pipelineConfig';
    else if (resource.configurationKind === 'job') kind = 'jobConfig';
    else if (resource.configurationKind === 'environment') kind = 'substitutions';
    if (!kind) throw new Error('This resource has no supported inspection operation.');
    await this.host.inspectResource({ kind, resourceId: id });
  }
  async findConsumers(value: unknown): Promise<void> {
    const { id } = this.resourceNode(value);
    await this.host.findConsumers(id);
  }
  async revealResource(value: unknown): Promise<void> {
    const { node } = this.resourceNode(value);
    const file = this.model.resource(node)!;
    if (!file.exists) throw new Error(`This file does not exist: ${file.path}`);
    const fullPath = await containedPath(this.host.readProject().root, file.path);
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(fullPath));
  }
  async compareGenerated(value: unknown): Promise<void> {
    const { node, id } = this.resourceNode(value);
    const resource = this.model.resource(node);
    if (
      resource?.kind !== 'generated' ||
      resource.generatedKind !== 'source' ||
      !resource.exists ||
      resource.environment !== this.model.state.environment
    )
      throw new Error('Select a persisted source file for the active environment.');
    await this.host.compareGenerated(id);
  }
  async findAuthoringSource(value: unknown): Promise<void> {
    const { node, id } = this.resourceNode(value);
    const resource = this.model.resource(node);
    if (resource?.kind !== 'generated' || !resource.authoringSources?.length)
      throw new Error('This generated file has no verified authoring source.');
    await this.host.findAuthoringSource(id);
  }
  async createPipeline(): Promise<void> {
    this.host.requireTrust();
    this.host.readProject();
    if (this.host.isOperating)
      throw new Error('Wait for the current LHP operation before creating a flowgroup.');
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'First flowgroup',
          description: 'Create a new LHP flowgroup',
          guide: 'flowgroup' as const,
        },
        {
          label: 'Files to bronze',
          description: 'Guided file ingestion',
          guide: 'bronze' as const,
        },
        {
          label: 'Template instance',
          description: 'Reuse an installed template',
          guide: 'template' as const,
        },
        {
          label: 'Blueprint instance',
          description: 'Reuse an installed blueprint',
          guide: 'blueprint' as const,
        },
      ],
      { title: 'Add to LHP pipeline', placeHolder: 'Choose an authoring path' },
    );
    if (choice) this.startGuide(choice.guide);
  }
  private startGuide(
    guide: 'bronze' | 'template' | 'blueprint' | 'flowgroup',
    definition?: string,
  ): void {
    this.host.requireTrust();
    this.host.readProject();
    if (this.host.isOperating)
      throw new Error('Wait for the current LHP operation before creating a flowgroup.');
    this.host.showGuide(guide, definition);
  }
  async openEnvironmentSource(): Promise<void> {
    const project = this.host.readProject();
    const environment = this.host.environment(project);
    const choices = (this.host.resourceIndex?.files ?? []).filter(
      (file) =>
        file.kind === 'configuration' &&
        file.configurationKind === 'environment' &&
        (file.environment === environment || !file.environment) &&
        file.exists,
    );
    if (!choices.length)
      throw new Error(`No local environment source is indexed for ${environment}.`);
    const choice =
      choices.length === 1
        ? choices[0]
        : await vscode.window
            .showQuickPick(
              choices.map((file) => ({ label: file.path, file })),
              { placeHolder: `Open ${environment} environment source` },
            )
            .then((value) => value?.file);
    if (choice) await this.host.openResource(choice.id);
  }
  async revealProject(): Promise<void> {
    const project = this.host.readProject();
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(project.root));
  }
  private async instanceGuide(kind: 'template' | 'blueprint', value: unknown): Promise<void> {
    const { node } = this.resourceNode(value);
    const resource = this.model.resource(node)!;
    if (resource.kind !== kind || !resource.registered)
      throw new Error(`Select a registered ${kind} definition to create an instance.`);
    this.startGuide(kind, resource.name);
  }
  dispose(): void {
    for (const disposable of this.subscriptions) disposable.dispose();
    for (const view of this.views.values()) view.dispose();
    for (const provider of this.providers.values()) provider.dispose();
  }
}
