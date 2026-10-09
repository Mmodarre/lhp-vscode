import * as vscode from 'vscode';
import * as path from 'node:path';
import { BridgeClient, type BridgeCall } from './bridgeClient';
import { operate, databricks } from './projectOperations';
import { Problems } from './diagnostics';
import { createProject, selectInterpreter, setupEnvironment } from './onboarding';
import { dispatch } from './dispatch';
import { ensureOnboardingTrust, onboardingContext } from './onboardingTrust';
import { DesignerPanel } from './panel';
import { ignoredProjectPath, relativePath } from './paths';
import { PreviewDocuments } from './preview';
import { discoverProjects, type Project } from './projects';
import { refreshProject } from './refresh';
import { OperationQueue } from './operationQueue';
import { LatestTask } from './latestTask';
import { callBridge } from './projectCalls';
import { ProjectWorkspace } from './projectWorkspace';
import { InspectionDocuments } from './inspectionDocuments';
import * as resourceActions from './resourceActions';
import * as inspectionActions from './projectInspection';
import { configureSandboxProfile } from './sandboxProfile';
import { sandboxScopeIdentity } from './sandboxState';
import * as sandboxHost from './sandboxHost';
import type { InspectionRequest } from './shared/protocol';
import {
  PROTOCOL_VERSION,
  type JsonObject,
  type JsonValue,
  type OperationStatus,
  type ProjectSnapshot,
  type RuntimeInfo,
  type SandboxViewState,
  type DesignerSelection,
  type WebviewRequest,
} from './shared/protocol';

export class Controller implements vscode.Disposable {
  readonly panel: DesignerPanel;
  readonly bridge: BridgeClient;
  readonly previews = new PreviewDocuments();
  readonly problems = new Problems();
  readonly workspace = new ProjectWorkspace(this);
  readonly inspections = new InspectionDocuments();
  get resourceIndex() {
    return this.workspace.index;
  }
  get catalog() {
    return this.workspace.catalog;
  }
  get runtime() {
    return this.workspace.runtime;
  }
  get datasets() {
    return this.workspace.datasets;
  }
  projects: Project[] = [];
  project?: Project;
  snapshot?: ProjectSnapshot;
  get sandboxMode(): 'off' | 'on' {
    return sandboxHost.sandboxMode(this);
  }
  get pipelineDisplay(): 'selected' | 'all' {
    return sandboxHost.pipelineDisplay(this);
  }
  get sandboxView(): SandboxViewState | undefined {
    return sandboxHost.currentSandboxView(this);
  }
  get sandboxIdentity(): string | undefined {
    const view = this.sandboxView;
    return view ? sandboxScopeIdentity(view) : undefined;
  }
  epoch = 0;
  private readonly stateChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.stateChanged.event;
  private designerSelection?: DesignerSelection;
  private pendingGuide?: {
    projectId: string;
    revision: number;
    guide: 'bronze' | 'template' | 'blueprint' | 'flowgroup';
    definition?: string;
  };
  status?: OperationStatus;
  private readonly discovery = new LatestTask();
  private readonly operations = new OperationQueue((status) => this.publishStatus(status));
  get isOperating(): boolean {
    return this.operations.running;
  }
  timer?: ReturnType<typeof setTimeout>;
  lastEdited?: vscode.Uri;
  private readonly output = vscode.window.createOutputChannel('Lakehouse Plumber');
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor(
    readonly context: vscode.ExtensionContext,
    private readonly onSnapshot: (snapshot: ProjectSnapshot, root: string) => void,
  ) {
    this.bridge = new BridgeClient(context.asAbsolutePath('bridge/lhp_bridge.py'), (message) =>
      this.output.appendLine(message),
    );
    this.panel = new DesignerPanel(context.extensionUri, (request) => this.receive(request));
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.sourceChanged(event.document.uri, event.document.isDirty),
      ),
      vscode.workspace.onDidSaveTextDocument((document) => this.sourceChanged(document.uri)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('lhp')) {
          this.invalidate();
          void this.refresh().catch((error) => this.report(error));
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.invalidate();
        void this.discover().catch((error) => this.report(error));
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.refresh().catch((error) => this.report(error));
      }),
      vscode.workspace.registerTextDocumentContentProvider('lhp-preview', this.previews),
      vscode.workspace.registerTextDocumentContentProvider('lhp-inspection', this.inspections),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate((uri) => this.fileTopologyChanged(uri)),
      watcher.onDidDelete((uri) => this.fileTopologyChanged(uri)),
      watcher.onDidChange((uri) => this.sourceChanged(uri)),
    );
  }
  private fileTopologyChanged(uri: vscode.Uri): void {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relative = folder ? relativePath(folder.uri.fsPath, uri.fsPath) : undefined;
    if (relative?.endsWith('lhp.yaml') && !ignoredProjectPath(relative)) {
      this.invalidate();
      void this.discover().catch((error) => this.report(error));
    } else {
      const local = this.project && relativePath(this.project.root, uri.fsPath);
      if (
        local &&
        this.ownsUri(uri) &&
        (!ignoredProjectPath(local) || local.startsWith('generated/'))
      )
        this.workspace.scheduleScan();
      this.sourceChanged(uri);
    }
  }
  private sourceChanged(uri: vscode.Uri, nativeDirtyEdit = false): void {
    if (uri.path.endsWith('/lhp.yaml') && !this.project) {
      void this.discover().catch((error) => this.report(error));
      return;
    }
    // Generation owns disk writes (including bundle resources). Do not abort it
    // on its own watcher notifications; a user's dirty native edit still cancels.
    if (this.operations.kind === 'generate' && !nativeDirtyEdit) return;
    if (!this.ownsUri(uri)) return;
    const relative =
      this.project && uri.scheme === 'file'
        ? relativePath(this.project.root, uri.fsPath)
        : undefined;
    if (!relative) return;
    if (relative.startsWith('generated/') || relative.startsWith('resources/lhp/')) {
      this.workspace.scheduleScan();
      void sandboxHost.noteOutputChanged(this, relative).catch((error) => this.report(error));
      return;
    }
    if (ignoredProjectPath(relative)) return;
    this.workspace.sourceChanged(uri);
    if (!/\.(?:ya?ml|sql|py|json|ddl)$/i.test(relative)) return;
    this.invalidate();
    if (this.snapshot) {
      this.snapshot = {
        ...this.snapshot,
        revision: this.epoch,
        stale: this.snapshot.flowgroups.length > 0,
        notices: this.snapshot.notices,
        refreshState: 'loading',
        refreshError: undefined,
      };
      this.panel.post({ type: 'snapshot', snapshot: this.snapshot });
      this.stateChanged.fire();
    }
    clearTimeout(this.timer);
    // Large graphs refresh explicitly: source browsing/completion remains cheap.
    if ((this.snapshot?.flowgroups.length ?? 0) > 500) {
      if (this.snapshot)
        this.snapshot = {
          ...this.snapshot,
          refreshState: 'ready',
          notices: [
            ...new Set([
              ...this.snapshot.notices,
              'Source changed. Refresh the semantic graph when ready.',
            ]),
          ],
        };
      if (this.snapshot) this.panel.post({ type: 'snapshot', snapshot: this.snapshot });
      this.notifyState();
      return;
    }
    this.timer = setTimeout(() => {
      void this.refresh()
        .then(async () => {
          if (
            this.snapshot?.context.runtime.compatible &&
            this.snapshot.refreshState === 'ready' &&
            !this.snapshot.stale &&
            vscode.workspace
              .getConfiguration('lhp', vscode.Uri.file(this.project!.root))
              .get<boolean>('autoValidate', true)
          )
            await this.operate('validate');
        })
        .catch((error) => this.report(error));
    }, 450);
  }
  private invalidate(): void {
    this.epoch++;
    this.designerSelection = undefined;
    this.pendingGuide = undefined;
    this.operations.cancel();
    this.previews.clear();
    this.inspections.clear();
    this.workspace.invalidate();
  }
  invalidateContext(): void {
    this.invalidate();
  }
  notifyState(): void {
    this.stateChanged.fire();
  }
  readProject(): Project {
    if (!this.project) throw new Error('Open or create an LHP project first.');
    return this.project;
  }
  ownsUri(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file' || !this.project) return false;
    const owner = this.projects
      .filter((project) => !!relativePath(project.root, uri.fsPath))
      .sort((a, b) => b.root.length - a.root.length)[0];
    return owner?.summary.id === this.project.summary.id;
  }
  requireTrust(): void {
    if (!vscode.workspace.isTrusted)
      throw new Error('Trust this workspace before running Python or editing project files.');
  }
  requireProject(): Project {
    this.requireTrust();
    return this.readProject();
  }
  assertContext(request: WebviewRequest): void {
    if (
      !this.snapshot ||
      request.context?.projectId !== this.project?.summary.id ||
      request.context?.revision !== this.snapshot.revision ||
      this.snapshot.revision !== this.epoch
    ) {
      throw new Error('This designer view is stale. Refresh before continuing.');
    }
  }
  bootstrap(): void {
    this.panel.post({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: this.projects.map((p) => p.summary),
      snapshot: this.snapshot,
      trusted: vscode.workspace.isTrusted,
      selection: this.designerSelection,
      logoUri: this.panel.logoUri,
      datasets: this.datasets,
      sandbox: this.sandboxView,
    });
    this.stateChanged.fire();
  }
  /** Ready handshakes consume navigation once; ordinary refreshes never replay it. */
  designerReady(): void {
    this.panel.markReady();
    this.bootstrap();
    this.designerSelection = undefined;
    if (this.pendingGuide) this.panel.post({ type: 'guide', ...this.pendingGuide });
    this.pendingGuide = undefined;
  }
  showSelection(selection: DesignerSelection): void {
    this.requireProject();
    if (selection.projectId !== this.project?.summary.id || selection.revision !== this.epoch)
      throw new Error('This tree selection is stale. Select a current item.');
    const wasReady = this.panel.isReady;
    this.designerSelection = wasReady ? undefined : selection;
    this.panel.show();
    this.bootstrap();
    if (wasReady) {
      this.panel.post({ type: 'select', selection });
      this.designerSelection = undefined;
    }
  }
  publishStatus(status: OperationStatus): void {
    this.status = status;
    this.panel.post({ type: 'status', status });
    this.stateChanged.fire();
  }
  async discover(): Promise<void> {
    await this.discovery.run(async (isCurrent) => {
      if (!isCurrent()) return;
      const projects = await discoverProjects();
      if (!isCurrent()) return;
      this.projects = projects;
      const previous = this.project?.summary.id;
      const selected = this.context.workspaceState.get<string>('lhp.activeProject');
      this.project =
        this.projects.find(
          (p) => p.summary.id === this.project?.summary.id || p.summary.id === selected,
        ) ?? this.projects[0];
      if (previous !== this.project?.summary.id) {
        this.invalidate();
        this.snapshot = undefined;
        this.problems.clear();
        this.workspace.reset(this.project);
      }
      this.bootstrap();
      await this.refreshResources();
      if (!isCurrent()) return;
      await this.refresh();
    });
  }
  async show(): Promise<void> {
    this.panel.show();
    this.bootstrap();
    if (!this.projects.length) await this.discover();
    else if (!this.snapshot && !this.isOperating) await this.refresh();
  }
  environment(project: Project): string {
    return (
      this.context.workspaceState.get<Record<string, string>>('lhp.environments', {})[
        project.summary.id
      ] ??
      vscode.workspace
        .getConfiguration('lhp', vscode.Uri.file(project.root))
        .get<string>('environment', 'dev')
    );
  }
  activePipelineConfig(project: Project): string {
    return (
      this.context.workspaceState.get<Record<string, string>>('lhp.pipelineConfigs', {})[
        project.summary.id
      ] ??
      vscode.workspace
        .getConfiguration('lhp', vscode.Uri.file(project.root))
        .get<string>('pipelineConfigPath', '')
    );
  }
  async call(
    operation: BridgeCall['operation'],
    project: Project,
    runtime: RuntimeInfo,
    signal: AbortSignal,
    options?: JsonObject,
  ): Promise<JsonValue> {
    return callBridge(this, operation, project, runtime, signal, options);
  }

  run<T>(
    operation: OperationStatus['operation'],
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    return this.operations.run(operation, task);
  }
  async refresh(): Promise<void> {
    if (!this.project || !vscode.workspace.isTrusted) {
      this.bootstrap();
      return;
    }
    await refreshProject(this);
  }
  async publishSnapshot(snapshot: ProjectSnapshot, project: Project, epoch: number): Promise<void> {
    if (epoch !== this.epoch || project !== this.project) return;
    this.snapshot = snapshot;
    this.workspace.reconcile();
    const index = this.workspace.index;
    snapshot.resourceUsages = index
      ? Object.fromEntries(
          index.files
            .filter((resource) => (resource.knownUseCount ?? 0) > 0)
            .map((resource) => [
              resource.path,
              {
                knownUseCount: resource.knownUseCount ?? 0,
                usageComplete: resource.usageComplete === true,
                knownLabels: [
                  ...new Set(
                    (resource.knownUses ?? resource.consumers).map((use) =>
                      use.template
                        ? `Template ${use.template}`
                        : use.flowgroupId
                          ? use.label.split(' / ').slice(0, 2).join(' / ')
                          : use.label,
                    ),
                  ),
                ].slice(0, 12),
              },
            ]),
        )
      : undefined;
    this.panel.post({ type: 'snapshot', snapshot });
    this.stateChanged.fire();
    await this.problems.update(
      project.root,
      snapshot.diagnostics,
      () => epoch === this.epoch && project === this.project,
    );
    if (epoch === this.epoch && project === this.project && snapshot.refreshState === 'ready')
      this.onSnapshot(snapshot, project.root);
  }
  async selectProject(id?: string): Promise<void> {
    if (!this.projects.length) this.projects = await discoverProjects();
    const chosen = id
      ? this.projects.find((p) => p.summary.id === id)
      : await vscode.window
          .showQuickPick(
            this.projects.map((p) => ({
              label: p.summary.name,
              description: p.summary.rootLabel,
              project: p,
            })),
          )
          .then((p) => p?.project);
    if (!chosen) return;
    this.invalidate();
    this.project = chosen;
    this.snapshot = undefined;
    this.problems.clear();
    this.workspace.reset(chosen);
    await this.context.workspaceState.update('lhp.activeProject', chosen.summary.id);
    this.bootstrap();
    await this.refreshResources();
    await this.refresh();
  }
  async selectEnvironment(environment?: string): Promise<void> {
    const project = this.requireProject();
    const selected =
      environment ??
      (await vscode.window.showQuickPick(
        this.resourceIndex?.environments.length
          ? this.resourceIndex.environments
          : (this.snapshot?.context.environments ?? ['dev']),
        {
          title: 'LHP environment',
        },
      ));
    if (!selected) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(selected) || selected.includes('..'))
      throw new Error('Invalid environment name.');
    const allowed = this.sandboxView?.allowedEnvironments ?? [];
    if (this.sandboxMode === 'on' && allowed.length && !allowed.includes(selected))
      throw new Error(`Environment ${selected} is outside the team sandbox policy.`);
    const map = this.context.workspaceState.get<Record<string, string>>('lhp.environments', {});
    this.invalidate();
    await this.context.workspaceState.update('lhp.environments', {
      ...map,
      [project.summary.id]: selected,
    });
    await this.refresh();
  }
  async setSandboxMode(mode: 'off' | 'on'): Promise<void> {
    await sandboxHost.setSandboxMode(this, mode);
  }
  async setPipelineDisplay(display: 'selected' | 'all'): Promise<void> {
    await sandboxHost.setPipelineDisplay(this, display);
  }
  async configureSandboxProfile(): Promise<void> {
    await configureSandboxProfile(this);
  }
  async showSandboxScope(): Promise<void> {
    await sandboxHost.showSandboxScope(this);
  }
  async showUsages(path: string): Promise<void> {
    await sandboxHost.showUsages(this, path);
  }
  async recordOutputScope(identity: string): Promise<void> {
    await sandboxHost.recordOutputScope(this, identity);
  }
  async interpreter(setup = false): Promise<void> {
    if (
      !(await ensureOnboardingTrust(
        setup ? 'Set Up Python Environment' : 'Select Python Interpreter',
      ))
    )
      return;
    this.invalidate();
    const project = this.project;
    const selected = await (setup ? setupEnvironment : selectInterpreter)(
      project?.root,
      this.context,
      this.bridge,
      onboardingContext(() => this.project === project),
    );
    if (selected || this.project) await this.refresh();
  }
  async create(): Promise<void> {
    if (!(await ensureOnboardingTrust('Create Project'))) return;
    const checkContext = onboardingContext();
    const root = await createProject(
      this.context,
      this.bridge,
      this.snapshot?.context.runtime.interpreter,
      checkContext,
    );
    if (!root) return;
    checkContext();
    const uri = vscode.Uri.file(root);
    if (!vscode.workspace.getWorkspaceFolder(uri))
      vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
        uri,
      });
    await this.discover();
    if (!this.projects.some((p) => p.summary.id === uri.toString()))
      this.projects.push({
        root,
        summary: { id: uri.toString(), name: path.basename(root), rootLabel: root },
      });
    await this.selectProject(uri.toString());
  }
  async operate(operation: 'validate' | 'preview' | 'generate'): Promise<void> {
    await operate(this, operation);
  }
  async databricks(): Promise<void> {
    await databricks(this);
  }
  refreshResources(): Promise<void> {
    return this.workspace.refresh();
  }
  selectPipelineConfig(): Promise<void> {
    return resourceActions.selectPipelineConfig(this);
  }
  openResource(id: string): Promise<void> {
    return resourceActions.openResource(this, id);
  }
  findResource(): Promise<void> {
    return resourceActions.findResource(this);
  }
  findConsumers(id: string): Promise<void> {
    return resourceActions.findConsumers(this, id);
  }
  findAuthoringSource(id: string): Promise<void> {
    return resourceActions.findAuthoringSource(this, id);
  }
  inspectResource(request: InspectionRequest): Promise<void> {
    return inspectionActions.inspectResource(this, request);
  }
  loadData(): Promise<void> {
    return inspectionActions.loadData(this);
  }
  compareGenerated(id: string): Promise<void> {
    return inspectionActions.compareGenerated(this, id);
  }
  async showHelp(): Promise<void> {
    await vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'Mmodarre.lhp-vscode#lhp.getStarted',
      false,
    );
  }
  showGuide(guide: 'bronze' | 'template' | 'blueprint' | 'flowgroup', definition?: string): void {
    this.requireProject();
    this.pendingGuide = {
      projectId: this.readProject().summary.id,
      revision: this.epoch,
      guide,
      definition,
    };
    this.panel.show();
    this.bootstrap();
    if (this.panel.isReady) {
      this.panel.post({ type: 'guide', ...this.pendingGuide });
      this.pendingGuide = undefined;
    }
  }
  async receive(request: WebviewRequest): Promise<void> {
    await dispatch(this, request);
  }
  cancel(): void {
    this.operations.cancel();
  }
  report(error: unknown): void {
    this.panel.error(error);
    void vscode.window.showErrorMessage(
      error instanceof Error ? error.message : 'LHP operation failed.',
    );
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.cancel();
    this.bridge.dispose();
    this.panel.dispose();
    this.problems.dispose();
    this.previews.dispose();
    this.workspace.dispose();
    this.inspections.dispose();
    this.output.dispose();
    this.stateChanged.dispose();
    for (const disposable of this.subscriptions) disposable.dispose();
  }
}
