import type { EditorCatalog, ProjectSnapshot } from './shared/protocol';
import type { ProjectResourceIndex } from './shared/projectModel';

export type LhpSchemaKind =
  | 'project'
  | 'flowgroup'
  | 'instance'
  | 'authoring'
  | 'template'
  | 'blueprint'
  | 'preset'
  | 'substitution'
  | 'pipeline_config'
  | 'job_config'
  | 'schema'
  | 'profile';

/** Exact declared identities win over directory conventions. Unrelated YAML gets no LHP schema. */
export function classifyLhpYaml(
  relative: string,
  catalog?: EditorCatalog,
  inventory?: ProjectResourceIndex,
  snapshot?: ProjectSnapshot,
): LhpSchemaKind | undefined {
  if (!/\.ya?ml$/i.test(relative)) return undefined;
  if (relative === 'lhp.yaml') return 'project';
  if (relative === '.lhp/profile.yaml') return 'profile';
  const file = inventory?.files.find((entry) => entry.path === relative);
  if (file?.kind === 'configuration') {
    if (file.configurationKind === 'pipeline') return 'pipeline_config';
    if (
      file.configurationKind === 'job' ||
      (file.configurationKind === 'bundle-template' &&
        relative === 'templates/bundle/job_config.yaml')
    )
      return 'job_config';
    if (file.configurationKind === 'environment') return 'substitution';
    return undefined;
  }
  if (file?.kind === 'template' || catalog?.templates.some((item) => item.source.path === relative))
    return 'template';
  if (
    file?.kind === 'blueprint' ||
    catalog?.blueprints.some((item) => item.source.path === relative)
  )
    return 'blueprint';
  if (file?.kind === 'preset' || catalog?.presets.some((item) => item.source?.path === relative))
    return 'preset';
  if (file?.kind === 'schema') return 'schema';
  if (
    file?.kind === 'pipeline' ||
    snapshot?.flowgroups.some((group) => group.source.path === relative)
  )
    return 'authoring';
  if (relative === 'config/pipeline_config.yaml') return 'pipeline_config';
  if (relative === 'config/job_config.yaml') return 'job_config';
  if (/^schemas\/.*\.ya?ml$/i.test(relative)) return 'schema';
  if (/^substitutions\/.*\.ya?ml$/i.test(relative)) return 'substitution';
  if (/^blueprints\/.*\.ya?ml$/i.test(relative)) return 'blueprint';
  if (/^presets\/.*\.ya?ml$/i.test(relative)) return 'preset';
  if (/^templates\/bundle\//i.test(relative)) return undefined;
  if (/^templates\/.*\.ya?ml$/i.test(relative)) return 'template';
  if (/^pipelines\/.*\.ya?ml$/i.test(relative)) return 'authoring';
  return undefined;
}
