import type {
  ActionNode,
  FlowgroupDetail,
  OperationStatus,
  ProjectSnapshot,
  ProjectSummary,
  SourceRef,
} from './shared/protocol';

export type SidebarKind = 'project' | 'pipeline' | 'flowgroup' | 'action' | 'file';
export interface SidebarRef {
  id: string;
  kind: SidebarKind;
  projectId: string;
  revision: number;
}
export interface SidebarNode extends SidebarRef {
  label: string;
  description?: string;
  source?: SourceRef;
  pipeline?: string;
  flowgroupId?: string;
  actionId?: string;
  parentId?: string;
  childrenAvailable: boolean;
  missing?: boolean;
}
export interface SidebarState {
  projects: ProjectSummary[];
  selectedProjectId?: string;
  snapshot?: ProjectSnapshot;
  trusted: boolean;
  revision: number;
  operation?: OperationStatus;
}

/** A lazy view of the existing snapshot. Never reads files or invokes Python. */
export class SidebarModel {
  state: SidebarState = { projects: [], trusted: false, revision: 0 };
  private nodes = new Map<string, SidebarNode>();
  private childCache = new Map<string, SidebarNode[]>();
  private groups = new Map<string, FlowgroupDetail>();
  private actions = new Map<string, ActionNode>();
  private rootNodes?: SidebarNode[];

  update(state: SidebarState): boolean {
    const previous = this.state;
    this.state = state;
    if (
      previous.snapshot?.flowgroups === state.snapshot?.flowgroups &&
      previous.snapshot?.pipelines === state.snapshot?.pipelines &&
      previous.snapshot?.context.environment === state.snapshot?.context.environment &&
      previous.revision === state.revision &&
      previous.selectedProjectId === state.selectedProjectId &&
      previous.trusted === state.trusted &&
      JSON.stringify(previous.projects) === JSON.stringify(state.projects)
    )
      return false;
    this.nodes.clear();
    this.childCache.clear();
    this.rootNodes = undefined;
    if (previous.snapshot?.flowgroups !== state.snapshot?.flowgroups) {
      this.groups = new Map(state.snapshot?.flowgroups.map((group) => [group.id, group]));
      this.actions = new Map(
        state.snapshot?.flowgroups.flatMap((group) =>
          group.actions.map((action) => [action.id, action] as const),
        ),
      );
    }
    return true;
  }

  private get snapshot(): ProjectSnapshot | undefined {
    const { snapshot, selectedProjectId, trusted } = this.state;
    return trusted && snapshot?.context.project.id === selectedProjectId ? snapshot : undefined;
  }

  private add(
    kind: SidebarKind,
    projectId: string,
    key: string,
    values: Omit<SidebarNode, keyof SidebarRef>,
  ): SidebarNode {
    const node: SidebarNode = {
      id: JSON.stringify([projectId, kind, key]),
      projectId,
      kind,
      revision: this.state.revision,
      ...values,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  roots(): SidebarNode[] {
    return (this.rootNodes ??= this.state.projects.map((project) => {
      const active = project.id === this.state.selectedProjectId;
      return this.add('project', project.id, project.id, {
        label: project.name,
        description: active
          ? `${this.snapshot?.context.environment ?? 'selected'} · active`
          : 'select to load',
        source: { path: 'lhp.yaml' },
        childrenAvailable: active && !!this.snapshot?.pipelines.length,
      });
    }));
  }

  children(value?: SidebarNode): SidebarNode[] {
    if (!value) return this.roots();
    const node = this.resolve(value);
    const cached = this.childCache.get(node.id);
    if (cached) return cached;
    const snapshot = this.snapshot;
    if (!snapshot || node.projectId !== this.state.selectedProjectId) return [];
    const inherit = { parentId: node.id, pipeline: node.pipeline, flowgroupId: node.flowgroupId };
    let children: SidebarNode[] = [];
    if (node.kind === 'project') {
      children = snapshot.pipelines.map((pipeline) =>
        this.add('pipeline', node.projectId, pipeline.name, {
          label: pipeline.name,
          description: `${pipeline.flowgroups.length} flowgroups`,
          pipeline: pipeline.name,
          parentId: node.id,
          childrenAvailable: pipeline.flowgroups.length > 0,
        }),
      );
    } else if (node.kind === 'pipeline') {
      children = (
        snapshot.pipelines.find((pipeline) => pipeline.name === node.pipeline)?.flowgroups ?? []
      ).map((group) =>
        this.add('flowgroup', node.projectId, group.id, {
          ...inherit,
          label: group.name,
          description: `${group.actionCount} actions${group.origin.kind === 'direct' ? '' : ` · ${group.origin.kind}`}`,
          source: group.source,
          flowgroupId: group.id,
          childrenAvailable: group.actionCount > 0,
        }),
      );
    } else if (node.kind === 'flowgroup') {
      children = (this.groups.get(node.flowgroupId!)?.actions ?? []).map((action) =>
        this.add('action', node.projectId, action.id, {
          ...inherit,
          label: action.name,
          description: action.subtype ?? action.type,
          source: action.source,
          actionId: action.id,
          childrenAvailable: this.actionFiles(action).length > 0,
        }),
      );
    } else if (node.kind === 'action') {
      const action = this.actions.get(node.actionId!);
      children = action
        ? this.actionFiles(action).map(({ source, kind, missing }) =>
            this.add(
              'file',
              node.projectId,
              JSON.stringify([node.actionId, source.path, source.documentIndex, source.yamlPath]),
              {
                ...inherit,
                actionId: node.actionId,
                label: source.label ?? source.path.split('/').pop() ?? source.path,
                description: missing ? `${kind} · missing` : kind,
                source,
                missing,
                childrenAvailable: false,
              },
            ),
          )
        : [];
    }
    this.childCache.set(node.id, children);
    return children;
  }

  private actionFiles(action: ActionNode): { source: SourceRef; kind: string; missing: boolean }[] {
    const entries = action.relatedFiles.map((file) => ({
      source: file as SourceRef,
      kind: file.kind as string,
      missing: !file.exists,
    }));
    if (action.origin.definition)
      entries.push({ source: action.origin.definition, kind: 'shared definition', missing: false });
    if (action.origin.instance && ['template', 'blueprint'].includes(action.origin.kind))
      entries.push({ source: action.origin.instance, kind: 'instance YAML', missing: false });
    const seen = new Set<string>();
    return entries.filter(({ source }) => {
      const key = JSON.stringify([source.path, source.documentIndex, source.yamlPath]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Resolve command arguments against current host-owned nodes, never their paths. */
  resolve(value: unknown): SidebarNode {
    if (!value || typeof value !== 'object') throw new Error('Select an LHP tree item first.');
    const ref = value as Partial<SidebarRef>;
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

  getParent(node: SidebarNode): SidebarNode | undefined {
    return node.parentId ? this.nodes.get(node.parentId) : undefined;
  }

  get message(): string | undefined {
    if (!this.state.projects.length) return undefined; // Native viewsWelcome owns this state.
    if (!this.state.trusted) return 'Trust this workspace to load its LHP projects.';
    const snapshot = this.snapshot;
    if (this.state.operation?.running) return this.state.operation.message;
    if (!snapshot) return 'Choose Refresh to load the selected project.';
    if (!snapshot.context.runtime.compatible)
      return snapshot.context.runtime.message ?? 'Choose a compatible Python interpreter.';
    if (snapshot.refreshState === 'failed')
      return snapshot.refreshError ?? 'Refresh failed. Retry Refresh.';
    if (snapshot.refreshState === 'loading') return 'Refreshing project graph…';
    if (snapshot.stale) return 'Showing the last valid graph. Fix source errors and refresh.';
    if (!snapshot.pipelines.length)
      return 'No pipelines yet. Open the designer to create a flowgroup.';
    return undefined;
  }
}
