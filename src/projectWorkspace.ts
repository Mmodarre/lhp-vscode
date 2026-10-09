import * as vscode from 'vscode';
import type { Controller } from './controller';
import type { Project } from './projects';
import { normalizeCatalog } from './catalog';
import { projectOverlays } from './documents';
import { enrichResources, scanResources, updateResourceFile } from './resourceIndex';
import { relativePath } from './paths';
import { generatedProvenance } from './generatedProvenance';
import type { ResourceConsumer } from './shared/protocol';
import type {
  EditorCatalog,
  ProjectDatasetIndex,
  ProjectResourceIndex,
  RuntimeInfo,
} from './shared/protocol';

/** Independent physical/catalogue state; semantic refreshes never own file existence. */
export class ProjectWorkspace implements vscode.Disposable {
  index?: ProjectResourceIndex;
  catalog?: EditorCatalog;
  runtime?: RuntimeInfo;
  datasets?: ProjectDatasetIndex;
  private physical?: ProjectResourceIndex;
  private scan?: AbortController;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private editTimer?: ReturnType<typeof setTimeout>;
  private readonly changedFiles = new Set<string>();
  private readonly changedVersions = new Map<string, number>();
  private sourceRevision = 0;
  private projectId?: string;
  constructor(private readonly host: Controller) {}

  reset(project?: Project): void {
    this.scan?.abort();
    clearTimeout(this.scanTimer);
    clearTimeout(this.editTimer);
    this.changedFiles.clear();
    this.changedVersions.clear();
    this.sourceRevision++;
    this.projectId = project?.summary.id;
    this.index = this.physical = undefined;
    this.catalog = this.runtime = this.datasets = undefined;
    this.host.notifyState();
  }
  invalidate(): void {
    if (this.datasets) this.datasets = { ...this.datasets, stale: true };
  }
  scheduleScan(): void {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(
      () => void this.refresh().catch((error) => this.host.report(error)),
      180,
    );
  }
  sourceChanged(uri: vscode.Uri): void {
    if (!this.host.ownsUri(uri)) return;
    const project = this.host.project;
    const filename =
      project && uri.scheme === 'file' ? relativePath(project.root, uri.fsPath) : undefined;
    if (!filename) return;
    this.changedVersions.set(filename, ++this.sourceRevision);
    this.changedFiles.add(filename);
    clearTimeout(this.editTimer);
    this.editTimer = setTimeout(
      () => void this.updateChangedFiles().catch((error) => this.host.report(error)),
      180,
    );
  }
  private async updateChangedFiles(): Promise<void> {
    const project = this.host.project;
    if (!project || !this.physical) return;
    const names = [...this.changedFiles];
    this.changedFiles.clear();
    for (const [position, filename] of names.entries()) {
      const base = this.physical;
      const index = await updateResourceFile(project.root, base, filename, {
        revision: this.host.epoch,
        otherRoots: this.host.projects
          .filter((candidate) => candidate !== project)
          .map((candidate) => candidate.root),
        pipelineConfigPath: this.host.activePipelineConfig(project),
        overlays: projectOverlays(
          project.root,
          this.host.projects
            .filter((candidate) => candidate !== project)
            .map((candidate) => candidate.root),
        ),
      });
      if (project !== this.host.project) return;
      if (this.physical !== base) {
        for (const pending of names.slice(position)) this.changedFiles.add(pending);
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(
          () => void this.updateChangedFiles().catch((error) => this.host.report(error)),
          0,
        );
        return;
      }
      this.physical = index;
      // Keep existing semantic consumer links; replacing a document must not
      // walk every action in a large last-good graph on each keystroke.
      const changed = index.files.find((item) => item.path === filename);
      const previous = this.index?.files.find((item) => item.path === filename);
      const file = changed
        ? {
            ...changed,
            consumers: previous?.consumers ?? [],
            knownUses: previous?.knownUses,
            knownUseCount: previous?.knownUseCount,
            usageComplete: false,
          }
        : undefined;
      if (this.index)
        this.index = {
          ...this.index,
          revision: index.revision,
          tokens: index.tokens,
          files: this.index.files
            .filter((item) => item.path !== filename)
            .concat(file ? [file] : []),
        };
    }
    this.host.notifyState();
  }
  async refresh(): Promise<void> {
    const project = this.host.project;
    if (!project) return;
    if (this.projectId !== project.summary.id) this.reset(project);
    this.scan?.abort();
    const scan = new AbortController();
    let sourceRevision = this.sourceRevision;
    this.scan = scan;
    if (this.index) this.index = { ...this.index, loading: true };
    this.host.notifyState();
    try {
      let index = await scanResources(project.root, project.summary.id, {
        revision: this.host.epoch,
        signal: scan.signal,
        otherRoots: this.host.projects.filter((p) => p !== project).map((p) => p.root),
        pipelineConfigPath: this.host.activePipelineConfig(project),
        overlays: projectOverlays(
          project.root,
          this.host.projects
            .filter((candidate) => candidate !== project)
            .map((candidate) => candidate.root),
        ),
      });
      // The initial scan captured older native drafts. Replay only files edited
      // while it ran, and never publish an older classification over a new edit.
      while (
        !scan.signal.aborted &&
        sourceRevision !== this.sourceRevision &&
        project === this.host.project
      ) {
        const nextRevision = this.sourceRevision;
        for (const [filename, revision] of this.changedVersions) {
          if (revision <= sourceRevision) continue;
          index = await updateResourceFile(project.root, index, filename, {
            revision: this.host.epoch,
            signal: scan.signal,
            otherRoots: this.host.projects
              .filter((candidate) => candidate !== project)
              .map((candidate) => candidate.root),
            pipelineConfigPath: this.host.activePipelineConfig(project),
            overlays: projectOverlays(
              project.root,
              this.host.projects
                .filter((candidate) => candidate !== project)
                .map((candidate) => candidate.root),
            ),
          });
        }
        sourceRevision = nextRevision;
      }
      if (scan.signal.aborted || this.host.project !== project) return;
      if (project.discoveryWarning) index.warnings.push(project.discoveryWarning);
      this.physical = index;
      this.reconcile();
    } catch (error) {
      if (scan.signal.aborted) return;
      if (this.index)
        this.index = {
          ...this.index,
          loading: false,
          complete: false,
          warnings: [...this.index.warnings, 'Resource discovery failed. Refresh to retry.'],
        };
      throw error;
    } finally {
      if (this.scan === scan) this.scan = undefined;
      this.host.notifyState();
    }
  }
  reconcile(): void {
    if (this.physical)
      this.index = enrichResources(this.physical, this.catalog, this.host.snapshot);
    const project = this.host.project;
    if (project && this.index) {
      const mappings =
        this.host.context.workspaceState.get<Record<string, Record<string, ResourceConsumer[]>>>(
          'lhp.generatedProvenance',
          {},
        )[project.summary.id] ?? {};
      this.index = {
        ...this.index,
        files: this.index.files.map((entry) =>
          mappings[entry.path]
            ? { ...entry, kind: 'generated', authoringSources: mappings[entry.path] }
            : entry,
        ),
      };
    }
    this.host.notifyState();
  }
  async recordGeneration(response: unknown): Promise<void> {
    const project = this.host.project;
    const snapshot = this.host.snapshot;
    if (!project || !snapshot) return;
    const map = this.host.context.workspaceState.get<
      Record<string, Record<string, ResourceConsumer[]>>
    >('lhp.generatedProvenance', {});
    const sources = generatedProvenance(project.root, response, snapshot);
    await this.host.context.workspaceState.update('lhp.generatedProvenance', {
      ...map,
      [project.summary.id]: sources,
    });
  }
  async bootstrapCatalog(
    project: Project,
    runtime: RuntimeInfo,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      this.runtime?.interpreter !== runtime.interpreter ||
      this.runtime?.lhpVersion !== runtime.lhpVersion ||
      !runtime.compatible
    )
      this.catalog = undefined;
    this.runtime = runtime;
    this.host.notifyState();
    if (!runtime.compatible) return;
    const epoch = this.host.epoch;
    const raw = await this.host.call('catalog', project, runtime, signal);
    if (epoch !== this.host.epoch || signal.aborted || project !== this.host.project) return;
    this.catalog = normalizeCatalog(project.root, raw);
    this.reconcile();
  }
  dispose(): void {
    clearTimeout(this.scanTimer);
    clearTimeout(this.editTimer);
    this.scan?.abort();
  }
}
