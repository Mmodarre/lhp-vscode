import type { ProjectContext, ProjectSnapshot } from './shared/protocol';

/** A failed refresh must not turn an earlier interpreter or YAML finding into
 * the explanation for the current failure. Keep a graph only in its context. */
export function pendingSnapshot(
  previous: ProjectSnapshot | undefined,
  context: ProjectContext,
  revision: number,
): ProjectSnapshot {
  const retain =
    context.runtime.compatible &&
    previous?.context.project.id === context.project.id &&
    previous.context.environment === context.environment &&
    previous.context.runtime.interpreter === context.runtime.interpreter;
  return {
    ...(retain ? previous : undefined),
    revision,
    context,
    flowgroups: retain ? previous.flowgroups : [],
    flowgroupEdges: retain ? previous.flowgroupEdges : [],
    pipelines: retain ? previous.pipelines : [],
    documents: retain ? previous.documents : [],
    catalog: retain
      ? previous.catalog
      : { actions: [], templates: [], presets: [], blueprints: [], schemas: [] },
    diagnostics: [],
    stale: !!retain && previous.flowgroups.length > 0,
    notices: [],
    refreshState: context.runtime.compatible ? 'loading' : 'ready',
    refreshError: undefined,
  };
}

export function failedSnapshot(snapshot: ProjectSnapshot, error: unknown): ProjectSnapshot {
  return {
    ...snapshot,
    refreshState: 'failed',
    refreshError: error instanceof Error ? error.message : 'The project snapshot could not load.',
    diagnostics: [],
    notices: [],
    stale: snapshot.flowgroups.length > 0,
  };
}
