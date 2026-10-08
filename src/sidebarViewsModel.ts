import type {
  ActionNode,
  EditorCatalog,
  ProjectSnapshot,
  ProjectSummary,
  RuntimeInfo,
  SourceRef,
} from './shared/protocol';
import type {
  ProjectDatasetIndex,
  ProjectResource,
  ProjectResourceIndex,
} from './shared/projectModel';

export type ViewName = 'configuration' | 'pipelines' | 'resources' | 'data' | 'generated';
export type ItemKind =
  | 'config'
  | 'pipeline'
  | 'flowgroup'
  | 'action'
  | 'category'
  | 'resource'
  | 'dataset'
  | 'relation'
  | 'notice';
export type ItemIntent =
  | 'project'
  | 'environment'
  | 'interpreter'
  | 'pipelineConfig'
  | 'settings'
  | 'source'
  | 'designer'
  | 'resource'
  | 'loadData'
  | 'none';
export interface ItemRef {
  id: string;
  projectId: string;
  revision: number;
  kind: ItemKind;
}
export interface ViewItem extends ItemRef {
  view: ViewName;
  label: string;
  description?: string;
  parentId?: string;
  source?: SourceRef;
  pipeline?: string;
  flowgroupId?: string;
  actionId?: string;
  resourceId?: string;
  datasetId?: string;
  group?: string;
  intent: ItemIntent;
  expandable: boolean;
  missing?: boolean;
  stale?: boolean;
}
export interface ViewState {
  projects: ProjectSummary[];
  selectedProjectId?: string;
  snapshot?: ProjectSnapshot;
  resourceIndex?: ProjectResourceIndex;
  catalog?: EditorCatalog;
  datasets?: ProjectDatasetIndex;
  runtime?: RuntimeInfo;
  environment?: string;
  activePipelineConfig?: string;
  trusted: boolean;
  revision: number;
}
const CATEGORIES = [
  ['template', 'Templates'],
  ['blueprint', 'Blueprints'],
  ['preset', 'Presets'],
  ['schema', 'Schemas & transforms'],
  ['expectations', 'Expectations'],
  ['sql', 'SQL'],
  ['python', 'Python'],
] as const;

/** Native view projection. Nodes are created on expansion, never for unopened actions. */
export class SidebarViewsModel {
  state: ViewState = { projects: [], trusted: false, revision: 0 };
  private nodes = new Map<string, ViewItem>();
  private cachedRoots = new Map<ViewName, ViewItem[]>();
  private cachedChildren = new Map<string, ViewItem[]>();
  private groups = new Map<string, ProjectSnapshot['flowgroups'][number]>();
  private resources = new Map<string, ProjectResource>();

  update(next: ViewState): boolean {
    const prev = this.state;
    this.state = next;
    if (
      prev.selectedProjectId === next.selectedProjectId &&
      prev.revision === next.revision &&
      prev.snapshot?.revision === next.snapshot?.revision &&
      prev.snapshot?.stale === next.snapshot?.stale &&
      prev.snapshot?.context.environment === next.snapshot?.context.environment &&
      prev.snapshot?.flowgroups === next.snapshot?.flowgroups &&
      prev.snapshot?.pipelines === next.snapshot?.pipelines &&
      prev.resourceIndex === next.resourceIndex &&
      prev.catalog === next.catalog &&
      prev.datasets === next.datasets &&
      prev.runtime === next.runtime &&
      prev.environment === next.environment &&
      prev.activePipelineConfig === next.activePipelineConfig &&
      prev.trusted === next.trusted &&
      JSON.stringify(prev.projects) === JSON.stringify(next.projects)
    )
      return false;
    this.nodes.clear();
    this.cachedRoots.clear();
    this.cachedChildren.clear();
    this.groups = new Map(next.snapshot?.flowgroups.map((group) => [group.id, group]));
    this.resources = new Map(next.resourceIndex?.files.map((resource) => [resource.id, resource]));
    return true;
  }
  private get projectId(): string {
    return this.state.selectedProjectId ?? '';
  }
  private get snapshot(): ProjectSnapshot | undefined {
    return this.state.snapshot?.context.project.id === this.projectId
      ? this.state.snapshot
      : undefined;
  }
  private get index(): ProjectResourceIndex | undefined {
    return this.state.resourceIndex?.projectId === this.projectId
      ? this.state.resourceIndex
      : undefined;
  }
  private get data(): ProjectDatasetIndex | undefined {
    return this.state.datasets?.projectId === this.projectId ? this.state.datasets : undefined;
  }
  private get dataStale(): boolean {
    const data = this.data;
    const snapshot = this.snapshot;
    return (
      !!data &&
      (!snapshot ||
        data.stale ||
        snapshot.stale ||
        data.revision !== snapshot.revision ||
        data.environment !== snapshot.context.environment)
    );
  }
  private add(
    view: ViewName,
    kind: ItemKind,
    key: string,
    fields: Omit<ViewItem, keyof ItemRef | 'view' | 'kind' | 'intent'> & { intent?: ItemIntent },
  ): ViewItem {
    const item: ViewItem = {
      id: JSON.stringify([this.projectId, view, kind, key]),
      projectId: this.projectId,
      revision: this.state.revision,
      view,
      kind,
      intent: fields.intent ?? 'none',
      ...fields,
    };
    this.nodes.set(item.id, item);
    return item;
  }
  private notice(view: ViewName, key: string, label: string): ViewItem {
    return this.add(view, 'notice', key, { label, expandable: false });
  }
  roots(view: ViewName): ViewItem[] {
    const cached = this.cachedRoots.get(view);
    if (cached) return cached;
    if (!this.projectId) return [];
    let rows: ViewItem[];
    if (view === 'configuration') {
      const project = this.state.projects.find((entry) => entry.id === this.projectId);
      rows = [
        this.add(view, 'config', 'project', {
          label: 'Project',
          description: project?.name,
          group: 'project',
          source: { path: 'lhp.yaml' },
          expandable: false,
          intent: 'project',
        }),
        this.add(view, 'config', 'environment', {
          label: 'Environment',
          group: 'environment',
          description: this.state.environment ?? this.snapshot?.context.environment ?? 'dev',
          expandable: false,
          intent: this.state.trusted ? 'environment' : 'none',
        }),
        this.add(view, 'config', 'runtime', {
          label: 'Python / LHP',
          group: 'runtime',
          description: this.state.runtime?.compatible
            ? `LHP ${this.state.runtime.lhpVersion ?? 'ready'}`
            : (this.state.runtime?.message ?? 'Choose Python'),
          expandable: false,
          intent: this.state.trusted ? 'interpreter' : 'none',
        }),
        this.add(view, 'config', 'pipelineConfig', {
          label: 'Active pipeline config',
          group: 'pipelineConfig',
          description: this.state.activePipelineConfig || 'Not selected',
          source: this.state.activePipelineConfig
            ? { path: this.state.activePipelineConfig }
            : undefined,
          resourceId: this.index?.files.find(
            (file) => file.path === this.state.activePipelineConfig,
          )?.id,
          expandable: false,
          intent: this.state.activePipelineConfig
            ? 'pipelineConfig'
            : this.state.trusted
              ? 'pipelineConfig'
              : 'none',
        }),
        this.add(view, 'config', 'settings', {
          label: 'Settings',
          group: 'settings',
          expandable: true,
        }),
      ];
    } else if (view === 'pipelines') {
      rows = (this.snapshot?.pipelines ?? []).map((pipeline) =>
        this.add(view, 'pipeline', pipeline.name, {
          label: pipeline.name,
          description: `${pipeline.flowgroups.length} flowgroups`,
          pipeline: pipeline.name,
          expandable: pipeline.flowgroups.length > 0,
          intent: 'designer',
          stale: this.snapshot?.stale,
        }),
      );
      const count = this.index?.files.filter((file) => file.kind === 'pipeline').length ?? 0;
      if (count)
        rows.push(
          this.add(view, 'category', 'authoring', {
            label: 'Authoring files',
            description: this.index?.complete ? `${count}` : `${count}+ · incomplete`,
            group: 'authoring',
            expandable: true,
          }),
        );
      if (!rows.length)
        rows = [
          this.notice(
            view,
            'empty',
            this.index?.loading
              ? 'Finding authoring files…'
              : 'No pipelines resolved. Source files remain browsable.',
          ),
        ];
    } else if (view === 'resources') {
      rows = CATEGORIES.map(([kind, label]) => {
        const count = this.index?.files.filter((file) => file.kind === kind).length ?? 0;
        return this.add(view, 'category', kind, {
          label,
          group: kind,
          description: !this.index
            ? 'Index not loaded'
            : this.index.loading
              ? 'Indexing…'
              : this.index.complete
                ? String(count)
                : `${count}+ · incomplete`,
          expandable: count > 0,
        });
      });
    } else if (view === 'data') {
      rows = this.data
        ? [
            this.add(view, 'category', 'declared', {
              label: 'Declared tables & sinks',
              group: 'declared',
              description: String(
                this.data.datasets.filter((entry) => entry.kind !== 'external').length,
              ),
              expandable: true,
            }),
            this.add(view, 'category', 'external', {
              label: 'External & unresolved',
              group: 'external',
              description: String(
                this.data.datasets.filter((entry) => entry.kind === 'external').length,
              ),
              expandable: true,
            }),
          ]
        : [
            this.add(view, 'notice', 'load', {
              label: !this.state.trusted
                ? 'Trust workspace to load declared lineage'
                : this.state.runtime && !this.state.runtime.compatible
                  ? 'Select compatible Python for lineage'
                  : 'Load declared lineage',
              description: 'Local project model; no warehouse query',
              expandable: false,
              intent: !this.state.trusted
                ? 'none'
                : this.state.runtime && !this.state.runtime.compatible
                  ? 'interpreter'
                  : 'loadData',
            }),
          ];
    } else {
      const files = this.index?.files.filter((file) => file.kind === 'generated') ?? [];
      const environments = [...new Set(files.map((file) => file.environment ?? 'other'))].sort();
      rows = environments.map((environment) =>
        this.add(view, 'category', environment, {
          label: environment,
          group: environment,
          description: `${
            files.filter((file) => (file.environment ?? 'other') === environment).length
          } persisted files`,
          expandable: true,
        }),
      );
      if (!rows.length)
        rows = [
          this.notice(
            view,
            'empty',
            this.index?.loading
              ? 'Finding persisted output…'
              : !this.index
                ? 'File index not loaded.'
                : this.index.complete
                  ? 'No persisted generated output found.'
                  : 'No generated files indexed; inventory is incomplete.',
          ),
        ];
    }
    this.cachedRoots.set(view, rows);
    return rows;
  }
  children(parent: ViewItem): ViewItem[] {
    const node = this.resolve(parent);
    const cached = this.cachedChildren.get(node.id);
    if (cached) return cached;
    const resource = (file: ProjectResource): ViewItem =>
      this.add(node.view, 'resource', file.id, {
        label: file.name,
        description: file.path,
        source: file.source,
        resourceId: file.id,
        missing: !file.exists,
        parentId: node.id,
        expandable: false,
        intent: 'resource',
      });
    let rows: ViewItem[] = [];
    if (node.kind === 'pipeline')
      rows = (
        this.snapshot?.pipelines.find((entry) => entry.name === node.pipeline)?.flowgroups ?? []
      ).map((group) =>
        this.add(node.view, 'flowgroup', group.id, {
          label: group.name,
          description: `${group.actionCount} actions${group.origin.kind === 'direct' ? '' : ` · ${group.origin.kind}`}`,
          source: group.source,
          pipeline: group.pipeline,
          flowgroupId: group.id,
          parentId: node.id,
          expandable: group.actionCount > 0,
          intent: 'designer',
          stale: this.snapshot?.stale,
        }),
      );
    else if (node.kind === 'flowgroup')
      rows = (this.groups.get(node.flowgroupId!)?.actions ?? []).map((action) =>
        this.add(node.view, 'action', action.id, {
          label: action.name,
          description: action.subtype ?? action.type,
          source: action.source,
          pipeline: node.pipeline,
          flowgroupId: node.flowgroupId,
          actionId: action.id,
          parentId: node.id,
          expandable: this.actionFiles(action).length > 0,
          intent: 'source',
          stale: this.snapshot?.stale,
        }),
      );
    else if (node.kind === 'action')
      rows = this.actionFiles(
        this.groups.get(node.flowgroupId!)?.actions.find((action) => action.id === node.actionId),
      ).map(({ source, label, missing }) =>
        this.add(
          node.view,
          'resource',
          JSON.stringify([node.actionId, source.path, source.documentIndex, source.yamlPath]),
          {
            label: source.label ?? source.path.split('/').at(-1) ?? source.path,
            description: label,
            source,
            actionId: node.actionId,
            flowgroupId: node.flowgroupId,
            parentId: node.id,
            expandable: false,
            missing,
            intent: 'source',
            stale: this.snapshot?.stale,
          },
        ),
      );
    else if (node.view === 'resources' && node.kind === 'category')
      rows = (this.index?.files ?? []).filter((file) => file.kind === node.group).map(resource);
    else if (node.view === 'pipelines' && node.group === 'authoring')
      rows = (this.index?.files ?? []).filter((file) => file.kind === 'pipeline').map(resource);
    else if (node.view === 'configuration' && node.kind === 'config')
      rows = [
        this.add(node.view, 'notice', 'extension-settings', {
          label: 'LHP extension settings',
          parentId: node.id,
          expandable: false,
          intent: 'settings',
        }),
        ...(this.index?.files ?? []).filter((file) => file.kind === 'configuration').map(resource),
      ];
    else if (node.view === 'data' && node.kind === 'category')
      rows = (this.data?.datasets ?? [])
        .filter((entry) =>
          node.group === 'external' ? entry.kind === 'external' : entry.kind !== 'external',
        )
        .map((entry) =>
          this.add(node.view, 'dataset', entry.id, {
            label: entry.name,
            description: `${entry.producers.length} producers · ${entry.consumers.length} consumers`,
            datasetId: entry.id,
            parentId: node.id,
            expandable: true,
            intent: 'designer',
            stale: this.dataStale,
          }),
        );
    else if (node.kind === 'dataset') {
      const entry = this.data?.datasets.find((dataset) => dataset.id === node.datasetId);
      rows = [
        ...(entry?.producers ?? []).map((source, index) => ({ source, index, role: 'producer' })),
        ...(entry?.consumers ?? []).map((source, index) => ({ source, index, role: 'consumer' })),
      ].map(({ source, index, role }) =>
        this.add(node.view, 'relation', `${node.datasetId}:${role}:${index}`, {
          label: source.label,
          description: role,
          source: source.source,
          pipeline: source.pipeline,
          flowgroupId: source.flowgroupId,
          actionId: source.actionId,
          parentId: node.id,
          expandable: false,
          intent: source.source ? 'source' : 'none',
          stale: this.dataStale,
        }),
      );
    } else if (node.view === 'generated' && node.kind === 'category') {
      const files = (this.index?.files ?? []).filter(
        (file) => file.kind === 'generated' && (file.environment ?? 'other') === node.group,
      );
      rows = [...new Set(files.map((file) => file.generatedKind ?? 'other'))].sort().map((kind) =>
        this.add(node.view, 'category', `${node.group}:${kind}`, {
          label: kind,
          group: `${node.group}:${kind}`,
          description: String(
            files.filter((file) => (file.generatedKind ?? 'other') === kind).length,
          ),
          parentId: node.id,
          expandable: true,
        }),
      );
      if (node.parentId)
        rows = (this.index?.files ?? [])
          .filter(
            (file) =>
              file.kind === 'generated' &&
              `${file.environment ?? 'other'}:${file.generatedKind ?? 'other'}` === node.group,
          )
          .map(resource);
    }
    this.cachedChildren.set(node.id, rows);
    return rows;
  }
  private actionFiles(
    action?: ActionNode,
  ): { source: SourceRef; label: string; missing: boolean }[] {
    if (!action) return [];
    const files = action.relatedFiles.map((file) => ({
      source: file as SourceRef,
      label: file.exists ? file.kind : `${file.kind} · missing`,
      missing: !file.exists,
    }));
    if (action.origin.definition)
      files.push({ source: action.origin.definition, label: 'shared definition', missing: false });
    if (action.origin.instance && ['template', 'blueprint'].includes(action.origin.kind))
      files.push({ source: action.origin.instance, label: 'instance YAML', missing: false });
    const seen = new Set<string>();
    return files.filter(({ source }) => {
      const key = JSON.stringify([source.path, source.documentIndex, source.yamlPath]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  resolve(value: unknown): ViewItem {
    if (!value || typeof value !== 'object') throw new Error('Select an LHP tree item first.');
    const ref = value as Partial<ItemRef>;
    const node = typeof ref.id === 'string' ? this.nodes.get(ref.id) : undefined;
    if (
      !node ||
      ref.kind !== node.kind ||
      ref.projectId !== node.projectId ||
      ref.revision !== this.state.revision ||
      node.revision !== this.state.revision
    )
      throw new Error('This LHP tree item is stale. Select the current item and try again.');
    return node;
  }
  parent(node: ViewItem): ViewItem | undefined {
    return node.parentId ? this.nodes.get(node.parentId) : undefined;
  }
  resource(node: ViewItem): ProjectResource | undefined {
    return node.resourceId ? this.resources.get(node.resourceId) : undefined;
  }
  message(view: ViewName): string | undefined {
    if (!this.state.projects.length) return undefined;
    if (view === 'resources')
      return (
        this.index?.warnings[0] ??
        (this.index?.complete === false ? 'File inventory is incomplete.' : undefined)
      );
    if (view === 'data')
      return (
        this.data?.warnings[0] ??
        (this.dataStale ? 'Declared lineage is stale. Reload after source changes.' : undefined)
      );
    if (view === 'generated')
      return (
        this.index?.warnings[0] ??
        (this.index?.complete === false ? 'File inventory is incomplete.' : undefined)
      );
    if (view !== 'pipelines') return undefined;
    if (this.snapshot?.refreshState === 'failed') return this.snapshot.refreshError;
    if (this.snapshot?.stale) return 'Showing the last valid graph. Source files remain available.';
    if (!this.snapshot && !this.state.trusted)
      return 'Source browsing is available. Trust to load semantic graphs.';
    if (!this.snapshot) return 'Choose Refresh to load the project graph.';
    return undefined;
  }
}
