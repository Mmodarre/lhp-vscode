import type {
  EditorCatalog,
  ProjectSnapshot,
  ProjectSummary,
  RuntimeInfo,
  SandboxViewState,
  SourceRef,
} from './shared/protocol';
import type {
  ProjectDatasetIndex,
  ProjectResource,
  ProjectResourceIndex,
} from './shared/projectModel';
import { actionFileLinks, flowgroupFileLinks, resourceUsage } from './sidebarFileLinks';
import { configurationRows } from './sidebarConfiguration';
import { dataRoots, generatedRoots, resourceRoots } from './sidebarOtherRoots';

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
  | 'sandbox'
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
  usage?: { count: number; complete: boolean; labels: string[] };
  outOfScope?: boolean;
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
  sandbox?: SandboxViewState;
}
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
      JSON.stringify(prev.sandbox) === JSON.stringify(next.sandbox) &&
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
      rows = configurationRows(
        this.state,
        this.snapshot,
        this.index,
        this.projectId,
        (key, fields) => this.add(view, 'config', key, fields),
      );
    } else if (view === 'pipelines') {
      const sandbox = this.state.sandbox;
      const scoped =
        sandbox?.mode === 'on' &&
        sandbox.display === 'selected' &&
        sandbox.valid &&
        sandbox.scopeComplete;
      rows = (this.snapshot?.pipelines ?? [])
        .filter((pipeline) => !scoped || sandbox.selectedPipelines.includes(pipeline.name))
        .map((pipeline) =>
          this.add(view, 'pipeline', pipeline.name, {
            label: pipeline.name,
            description: `${pipeline.flowgroups.length} flowgroups${sandbox?.mode === 'on' && sandbox.valid && sandbox.scopeComplete && !sandbox.selectedPipelines.includes(pipeline.name) ? ' · outside sandbox scope' : ''}`,
            pipeline: pipeline.name,
            outOfScope:
              sandbox?.mode === 'on' &&
              sandbox.valid &&
              sandbox.scopeComplete &&
              !sandbox.selectedPipelines.includes(pipeline.name),
            expandable: pipeline.flowgroups.length > 0,
            intent: 'designer',
            stale: this.snapshot?.stale,
          }),
        );
      const fresh =
        !!this.snapshot && !this.snapshot.stale && this.snapshot.refreshState === 'ready';
      const used = new Set(
        fresh
          ? this.snapshot!.flowgroups.flatMap((fg) =>
              flowgroupFileLinks(fg).map((file) => file.source.path),
            )
          : [],
      );
      const count =
        this.index?.files.filter((file) => file.kind === 'pipeline' && !used.has(file.path))
          .length ?? 0;
      if (count)
        rows.push(
          this.add(view, 'category', 'authoring', {
            label: fresh ? 'Unmapped source files' : 'Source files',
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
      rows = resourceRoots(this.index, (view, kind, key, fields) =>
        this.add(view, kind, key, fields),
      );
    } else if (view === 'data') {
      rows = dataRoots(this.state, this.data, (view, kind, key, fields) =>
        this.add(view, kind, key, fields),
      );
    } else {
      rows = generatedRoots(this.index, (view, kind, key, fields) =>
        this.add(view, kind, key, fields),
      );
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
        usage: resourceUsage(this.index, file.path),
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
          expandable: true,
          intent: 'designer',
          stale: this.snapshot?.stale,
        }),
      );
    else if (node.kind === 'flowgroup') {
      const group = this.groups.get(node.flowgroupId!);
      rows = (group ? flowgroupFileLinks(group) : []).map((file) =>
        this.add(node.view, 'resource', JSON.stringify([node.flowgroupId, file.source.path]), {
          label: file.source.path.split('/').at(-1) ?? file.source.path,
          description: `${file.role} · ${file.source.path}`,
          source: file.source,
          resourceId: this.index?.files.find((entry) => entry.path === file.source.path)?.id,
          pipeline: node.pipeline,
          flowgroupId: node.flowgroupId,
          parentId: node.id,
          expandable: false,
          missing: file.missing,
          intent: 'source',
          usage: resourceUsage(this.index, file.source.path),
          stale: this.snapshot?.stale,
        }),
      );
      rows.push(
        ...(group?.actions ?? []).map((action) =>
          this.add(node.view, 'action', action.id, {
            label: action.name,
            description: action.subtype ?? action.type,
            source: action.source,
            pipeline: node.pipeline,
            flowgroupId: node.flowgroupId,
            actionId: action.id,
            parentId: node.id,
            expandable: actionFileLinks(action).length > 0,
            intent: 'source',
            stale: this.snapshot?.stale,
          }),
        ),
      );
    } else if (node.kind === 'action')
      rows = actionFileLinks(
        this.groups.get(node.flowgroupId!)?.actions.find((action) => action.id === node.actionId),
      ).map(({ source, role, missing, dynamic }) =>
        this.add(
          node.view,
          dynamic ? 'notice' : 'resource',
          JSON.stringify([node.actionId, source.path, source.documentIndex, source.yamlPath]),
          {
            label: dynamic
              ? `Unresolved ${source.path}`
              : (source.label ?? source.path.split('/').at(-1) ?? source.path),
            description: dynamic ? `${role} · dynamic path; no physical file resolved` : role,
            source: dynamic ? undefined : source,
            actionId: node.actionId,
            flowgroupId: node.flowgroupId,
            parentId: node.id,
            expandable: false,
            missing,
            intent: dynamic ? 'none' : 'source',
            stale: this.snapshot?.stale,
            usage: resourceUsage(this.index, source.path),
          },
        ),
      );
    else if (node.view === 'resources' && node.kind === 'category')
      rows = (this.index?.files ?? []).filter((file) => file.kind === node.group).map(resource);
    else if (node.view === 'pipelines' && node.group === 'authoring')
      rows = (this.index?.files ?? [])
        .filter((file) => {
          if (file.kind !== 'pipeline') return false;
          if (!this.snapshot || this.snapshot.stale || this.snapshot.refreshState !== 'ready')
            return true;
          return !this.snapshot.flowgroups.some((fg) =>
            flowgroupFileLinks(fg).some((link) => link.source.path === file.path),
          );
        })
        .map(resource);
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
    if (this.state.sandbox?.mode === 'on' && !this.state.sandbox.scopeComplete)
      return `Sandbox scope unresolved: ${this.state.sandbox.error ?? 'refresh .lhp/profile.yaml'}. Source browsing remains available.`;
    if (this.snapshot?.refreshState === 'failed') return this.snapshot.refreshError;
    if (this.snapshot?.stale) return 'Showing the last valid graph. Source files remain available.';
    if (!this.snapshot && !this.state.trusted)
      return 'Source browsing is available. Trust to load semantic graphs.';
    if (!this.snapshot) return 'Choose Refresh to load the project graph.';
    return undefined;
  }
}
