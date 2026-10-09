import type { ActionNode, FlowgroupDetail, SourceRef } from './shared/protocol';
import type { ProjectResourceIndex } from './shared/projectModel';
import type { ViewItem } from './sidebarViewsModel';

export interface FlowgroupFileLink {
  source: SourceRef;
  role: string;
  missing: boolean;
}

/** One direct child per physical file. Action children keep the precise field link. */
export function flowgroupFileLinks(group: FlowgroupDetail): FlowgroupFileLink[] {
  const files = new Map<string, FlowgroupFileLink>();
  const add = (source: SourceRef | undefined, role: string, missing = false): void => {
    if (!source?.path) return;
    const existing = files.get(source.path);
    if (existing) {
      if (!existing.role.split(' · ').includes(role)) existing.role += ` · ${role}`;
      existing.missing &&= missing;
    } else files.set(source.path, { source: { path: source.path }, role, missing });
  };
  add(group.source, group.origin.kind === 'direct' ? 'flowgroup YAML' : 'flowgroup source');
  add(group.origin.instance, 'instance YAML');
  add(group.origin.definition, 'shared definition');
  for (const action of group.actions) {
    add(action.source, 'action YAML');
    // An action authored directly in an instance is not part of its shared template.
    if (action.origin.kind !== 'direct') add(action.origin.definition, 'shared definition');
    for (const related of action.relatedFiles)
      if (!related.dynamic) add(related, related.kind, !related.exists);
  }
  return [...files.values()].sort((a, b) => a.source.path.localeCompare(b.source.path));
}

export function actionFileLinks(
  action?: ActionNode,
): (FlowgroupFileLink & { dynamic?: boolean })[] {
  if (!action) return [];
  const files: (FlowgroupFileLink & { dynamic?: boolean })[] = action.relatedFiles.map((file) => ({
    source: file,
    role: file.exists ? file.kind : `${file.kind} · missing`,
    missing: !file.exists,
    dynamic: file.dynamic,
  }));
  if (action.origin.kind !== 'direct' && action.origin.definition)
    files.push({ source: action.origin.definition, role: 'shared definition', missing: false });
  if (action.origin.instance && ['template', 'blueprint'].includes(action.origin.kind))
    files.push({ source: action.origin.instance, role: 'instance YAML', missing: false });
  const seen = new Set<string>();
  return files.filter(({ source }) => {
    const key = JSON.stringify([source.path, source.documentIndex, source.yamlPath]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resourceUsage(
  index: ProjectResourceIndex | undefined,
  path: string,
): ViewItem['usage'] {
  const resource = index?.files.find((entry) => entry.path === path);
  if (!resource) return undefined;
  const uses = resource.knownUses ?? resource.consumers;
  return {
    count:
      resource.knownUseCount ??
      new Set(
        uses.map((use) =>
          use.template
            ? `template:${use.template}`
            : use.flowgroupId
              ? `flowgroup:${use.flowgroupId}`
              : use.label,
        ),
      ).size,
    complete: resource.usageComplete === true,
    labels: [
      ...new Set(
        uses.map((use) =>
          use.template
            ? `Template ${use.template}`
            : use.flowgroupId
              ? use.label.split(' / ').slice(0, 2).join(' / ')
              : use.label,
        ),
      ),
    ].slice(0, 12),
  };
}
