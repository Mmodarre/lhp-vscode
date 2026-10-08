import * as vscode from 'vscode';
import * as path from 'node:path';
import { BridgeClient, BridgeError, type BridgeCall } from './bridgeClient';
import { text } from './catalog';
import { operate, databricks } from './projectOperations';
import { projectOverlays } from './documents';
import { Problems } from './diagnostics';
import { createProject, selectInterpreter, setupEnvironment } from './onboarding';
import { dispatch } from './dispatch';
import { DesignerPanel } from './panel';
import { ignoredProjectPath, relativePath } from './paths';
import { PreviewDocuments } from './preview';
import { discoverProjects, type Project } from './projects';
import { refreshProject } from './refresh';
import {
  PROTOCOL_VERSION,
  type JsonObject,
  type JsonValue,
  type OperationStatus,
  type ProjectSnapshot,
  type RuntimeInfo,
  type DesignerSelection,
  type WebviewRequest,
} from './shared/protocol';

export class Controller implements vscode.Disposable {
  readonly panel: DesignerPanel;
  readonly bridge: BridgeClient;
  readonly previews = new PreviewDocuments();
  readonly problems = new Problems();
  projects: Project[] = [];
  project?: Project;
  snapshot?: ProjectSnapshot;
  epoch = 0;
  private readonly stateChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.stateChanged.event;
  private designerSelection?: DesignerSelection;
  status?: OperationStatus;
  private discovery = 0;
  private operation?: {
    controller: AbortController;
    operation: OperationStatus['operation'];
    completion: Promise<void>;
  };
  private shutdownFailed = false;
  get isOperating(): boolean {
    return !!this.operation;
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
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml,sql,py,json}');
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
    } else this.sourceChanged(uri);
  }
  private sourceChanged(uri: vscode.Uri, nativeDirtyEdit = false): void {
    if (uri.path.endsWith('/lhp.yaml') && !this.project) {
      void this.discover().catch((error) => this.report(error));
      return;
    }
    // Generation owns disk writes (including bundle resources). Do not abort it
    // on its own watcher notifications; a user's dirty native edit still cancels.
    if (this.operation?.operation === 'generate' && !nativeDirtyEdit) return;
    const relative =
      this.project && uri.scheme === 'file'
        ? relativePath(this.project.root, uri.fsPath)
        : undefined;
    if (!relative || ignoredProjectPath(relative)) return;
    this.invalidate();
    if (this.snapshot) {
      this.snapshot = {
        ...this.snapshot,
        revision: this.epoch,
        stale: this.snapshot.flowgroups.length > 0,
        notices: [],
        refreshState: 'loading',
        refreshError: undefined,
      };
      this.panel.post({ type: 'snapshot', snapshot: this.snapshot });
      this.stateChanged.fire();
    }
    clearTimeout(this.timer);
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
    this.operation?.controller.abort();
    this.previews.clear();
  }
  requireTrust(): void {
    if (!vscode.workspace.isTrusted)
      throw new Error('Trust this workspace before running Python or editing project files.');
  }
  requireProject(): Project {
    this.requireTrust();
    if (!this.project) throw new Error('Open or create an LHP project first.');
    return this.project;
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
    });
    this.stateChanged.fire();
  }
  /** Ready handshakes consume navigation once; ordinary refreshes never replay it. */
  designerReady(): void {
    this.panel.markReady();
    this.bootstrap();
    this.designerSelection = undefined;
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
  private publishStatus(status: OperationStatus): void {
    this.status = status;
    this.panel.post({ type: 'status', status });
    this.stateChanged.fire();
  }
  async discover(): Promise<void> {
    const discovery = ++this.discovery;
    const projects = await discoverProjects();
    if (discovery !== this.discovery) return;
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
    }
    this.bootstrap();
    await this.refresh();
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
  private options(project: Project): JsonObject {
    return {
      includeTests: vscode.workspace
        .getConfiguration('lhp', vscode.Uri.file(project.root))
        .get<boolean>('includeTestsInGeneration', false),
      pipelineConfigPath:
        this.context.workspaceState.get<Record<string, string>>('lhp.pipelineConfigs', {})[
          project.summary.id
        ] ??
        vscode.workspace
          .getConfiguration('lhp', vscode.Uri.file(project.root))
          .get<string>('pipelineConfigPath', ''),
    };
  }
  async call(
    operation: BridgeCall['operation'],
    project: Project,
    runtime: RuntimeInfo,
    signal: AbortSignal,
    options?: JsonObject,
  ): Promise<JsonValue> {
    return this.bridge.call({
      operation,
      interpreter: runtime.interpreter,
      projectRoot: project.root,
      environment: this.environment(project),
      signal,
      documents: operation === 'generate' ? undefined : projectOverlays(project.root),
      options: { ...this.options(project), ...options },
      timeoutMs:
        vscode.workspace.getConfiguration('lhp').get<number>('operationTimeoutSeconds', 180) * 1000,
      onEvent: (event) => {
        if (!signal.aborted)
          this.publishStatus({
            operation:
              operation === 'scaffold'
                ? 'create'
                : operation === 'catalog' || operation === 'health' || operation === 'init'
                  ? 'snapshot'
                  : operation,
            running: true,
            message: text(event.message, text(event.kind)),
          });
      },
    });
  }
  async run<T>(
    operation: OperationStatus['operation'],
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.shutdownFailed)
      throw new Error(
        'The previous Python process could not be stopped. Restart VS Code after stopping it before running another operation.',
      );
    while (this.operation) {
      const previous = this.operation;
      if (previous.operation === 'snapshot' || previous.controller.signal.aborted) {
        previous.controller.abort();
        await previous.completion;
        if (this.shutdownFailed) throw new Error('The previous Python process did not close.');
      } else
        throw new Error('An LHP operation is already running. Cancel it before starting another.');
    }
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const current = { controller: new AbortController(), operation, completion };
    this.operation = current;
    let failed = false;
    this.publishStatus({ operation, running: true, message: `LHP ${operation}…` });
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `LHP ${operation}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const disposable = token.onCancellationRequested(() => current.controller.abort());
          try {
            return await task(current.controller.signal);
          } finally {
            disposable.dispose();
          }
        },
      );
    } catch (error) {
      failed = !current.controller.signal.aborted;
      if (error instanceof BridgeError && error.code === 'PROCESS_SHUTDOWN') {
        this.shutdownFailed = true;
        throw error;
      }
      if (!current.controller.signal.aborted) throw error;
      return undefined;
    } finally {
      if (this.operation === current) {
        this.operation = undefined;
        this.publishStatus({
          operation,
          running: false,
          message: this.shutdownFailed
            ? 'Python shutdown failed.'
            : current.controller.signal.aborted
              ? 'Operation cancelled.'
              : failed
                ? 'Operation failed.'
                : 'Ready.',
        });
      }
      complete();
    }
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
    await this.context.workspaceState.update('lhp.activeProject', chosen.summary.id);
    this.bootstrap();
    await this.refresh();
  }
  async selectEnvironment(environment?: string): Promise<void> {
    const project = this.requireProject();
    const selected =
      environment ??
      (await vscode.window.showQuickPick(this.snapshot?.context.environments ?? ['dev'], {
        title: 'LHP environment',
      }));
    if (!selected) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(selected) || selected.includes('..'))
      throw new Error('Invalid environment name.');
    const map = this.context.workspaceState.get<Record<string, string>>('lhp.environments', {});
    this.invalidate();
    await this.context.workspaceState.update('lhp.environments', {
      ...map,
      [project.summary.id]: selected,
    });
    await this.refresh();
  }
  async interpreter(setup = false): Promise<void> {
    this.requireTrust();
    this.invalidate();
    const selected = await (setup ? setupEnvironment : selectInterpreter)(
      this.project?.root,
      this.context,
      this.bridge,
    );
    if (selected || this.project) await this.refresh();
  }
  async create(): Promise<void> {
    this.requireTrust();
    const root = await createProject(
      this.context,
      this.bridge,
      this.snapshot?.context.runtime.interpreter,
    );
    if (!root) return;
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
  async receive(request: WebviewRequest): Promise<void> {
    await dispatch(this, request);
  }
  cancel(): void {
    this.operation?.controller.abort();
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
    this.output.dispose();
    this.stateChanged.dispose();
    for (const disposable of this.subscriptions) disposable.dispose();
  }
}
