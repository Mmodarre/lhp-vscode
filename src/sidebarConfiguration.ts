import type { ProjectResourceIndex } from './shared/projectModel';
import type { ProjectSnapshot } from './shared/protocol';
import type { ItemIntent, ItemRef, ViewItem, ViewState } from './sidebarViewsModel';

type Fields = Omit<ViewItem, keyof ItemRef | 'view' | 'kind' | 'intent'> & { intent?: ItemIntent };

export function configurationRows(
  state: ViewState,
  snapshot: ProjectSnapshot | undefined,
  index: ProjectResourceIndex | undefined,
  projectId: string,
  add: (key: string, fields: Fields) => ViewItem,
): ViewItem[] {
  const project = state.projects.find((entry) => entry.id === projectId);
  return [
    add('project', {
      label: 'Project',
      description: project?.name,
      group: 'project',
      source: { path: 'lhp.yaml' },
      expandable: false,
      intent: 'project',
    }),
    add('environment', {
      label: 'Environment',
      group: 'environment',
      description: state.environment ?? snapshot?.context.environment ?? 'dev',
      expandable: false,
      intent: state.trusted ? 'environment' : 'none',
    }),
    add('sandbox', {
      label: 'Sandbox',
      group: 'sandbox',
      description:
        state.sandbox?.mode === 'on'
          ? `On · ${state.sandbox.namespace ?? 'profile needed'} · ${state.sandbox.selectedPipelines.length} pipeline(s)${state.sandbox.profileSource === 'draft' ? ' · unsaved draft' : ''}${state.sandbox.valid ? '' : ' · blocked'}`
          : 'Off · full project',
      source: state.sandbox?.profileExists ? { path: '.lhp/profile.yaml' } : undefined,
      expandable: false,
      intent: 'sandbox',
    }),
    add('runtime', {
      label: 'Python / LHP',
      group: 'runtime',
      description: state.runtime?.compatible
        ? `LHP ${state.runtime.lhpVersion ?? 'ready'}`
        : (state.runtime?.message ?? 'Choose Python'),
      expandable: false,
      intent: state.trusted ? 'interpreter' : 'none',
    }),
    add('pipelineConfig', {
      label: 'Active pipeline config',
      group: 'pipelineConfig',
      description: state.activePipelineConfig || 'Not selected',
      source: state.activePipelineConfig ? { path: state.activePipelineConfig } : undefined,
      resourceId: index?.files.find((file) => file.path === state.activePipelineConfig)?.id,
      expandable: false,
      intent: state.activePipelineConfig
        ? 'pipelineConfig'
        : state.trusted
          ? 'pipelineConfig'
          : 'none',
    }),
    add('settings', { label: 'Settings', group: 'settings', expandable: true }),
  ];
}
