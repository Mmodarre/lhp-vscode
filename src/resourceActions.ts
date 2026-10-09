import * as vscode from 'vscode';
import { lstat } from 'node:fs/promises';
import type { Controller } from './controller';
import type { ProjectResource } from './shared/protocol';
import { containedPath, relativePath } from './paths';
import { openSource } from './documents';

export function resolveResource(host: Controller, id: string): ProjectResource {
  const project = host.readProject();
  const index = host.resourceIndex;
  const resource =
    index?.projectId === project.summary.id
      ? index.files.find((item) => item.id === id)
      : undefined;
  if (!resource)
    throw new Error(
      'This resource is no longer in the active project. Refresh and select it again.',
    );
  return resource;
}
export async function openResource(host: Controller, id: string): Promise<void> {
  const project = host.readProject();
  const resource = resolveResource(host, id);
  if (!resource.exists) throw new Error(`The referenced file is missing: ${resource.path}`);
  const filename = await containedPath(project.root, resource.path);
  if (project !== host.project) return;
  if (!/\.(ya?ml|json|sql|py|ddl|toml|ini|cfg|txt|md|csv|xml|sh|ps1|r)$/i.test(resource.path)) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filename));
    return;
  }
  await openSource(project.root, resource.source, false, vscode.ViewColumn.Active);
}
export async function findResource(host: Controller): Promise<void> {
  const project = host.readProject();
  if (!host.resourceIndex) await host.refreshResources();
  if (project !== host.project) return;
  const chosen = await vscode.window.showQuickPick(
    (host.resourceIndex?.files ?? []).map((item) => ({
      label: item.name,
      description: item.path,
      detail: item.exists ? item.kind : 'Missing reference',
      id: item.id,
    })),
    { title: 'Find LHP resource', matchOnDescription: true, matchOnDetail: true },
  );
  if (chosen && project === host.project) await openResource(host, chosen.id);
}
export async function findConsumers(host: Controller, id: string): Promise<void> {
  const project = host.readProject();
  const resource = resolveResource(host, id);
  const choices = resource.consumers.flatMap((use) => [
    {
      label: use.label,
      description: use.source.path,
      detail: use.template ? 'Shared template reference' : 'Authored file reference',
      source: use.source,
    },
    ...(use.instance && use.instance.path !== use.source.path
      ? [
          {
            label: `${use.label} · invocation`,
            description: use.instance.path,
            detail: 'Flowgroup instance YAML',
            source: use.instance,
          },
        ]
      : []),
  ]);
  const chosen = await vscode.window.showQuickPick(choices, {
    title: host.snapshot?.stale ? 'Known consumers (semantic graph is stale)' : 'Known consumers',
    placeHolder: resource.consumers.length
      ? 'Open authoring source'
      : 'No static consumers are indexed; dynamic references may still exist.',
  });
  if (chosen && project === host.project)
    await openSource(project.root, chosen.source, false, vscode.ViewColumn.Active);
}
export async function findAuthoringSource(host: Controller, id: string): Promise<void> {
  const project = host.readProject();
  const sources = resolveResource(host, id).authoringSources;
  if (!sources?.length)
    throw new Error(
      'No verified authoring-source mapping exists for this artifact. Generate the project to record provenance.',
    );
  const selected =
    sources.length === 1
      ? sources[0]
      : await vscode.window
          .showQuickPick(
            sources.map((source) => ({
              label: source.label,
              description: source.source.path,
              source,
            })),
            { title: 'Sources recorded during generation' },
          )
          .then((item) => item?.source);
  if (selected && project === host.project)
    await openSource(project.root, selected.source, false, vscode.ViewColumn.Active);
}
export async function selectPipelineConfig(host: Controller): Promise<void> {
  host.requireTrust();
  const project = host.readProject();
  const items = [
    { label: 'Use LHP defaults', description: 'No explicit pipeline config', path: '' },
    ...(host.resourceIndex?.files ?? [])
      .filter((item) => item.configurationKind === 'pipeline' && item.exists)
      .map((item) => ({
        label: item.path,
        description: 'Pipeline configuration',
        path: item.path,
      })),
    {
      label: 'Choose a custom pipeline configuration…',
      description: 'Select a project-contained YAML file',
      path: '__choose__',
    },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select active LHP pipeline configuration',
    matchOnDescription: true,
  });
  if (!selected) return;
  if (selected.path === '__choose__') {
    const uris = await vscode.window.showOpenDialog({
      title: 'Select LHP pipeline configuration',
      defaultUri: vscode.Uri.file(project.root),
      canSelectMany: false,
      filters: { YAML: ['yaml', 'yml'] },
    });
    if (!uris?.[0]) return;
    const relative = relativePath(project.root, uris[0].fsPath);
    if (!relative) throw new Error('Select a pipeline configuration inside the active project.');
    selected.path = relative;
  }
  if (project !== host.project) throw new Error('Project changed while selecting configuration.');
  if (selected.path) await lstat(await containedPath(project.root, selected.path));
  const map = host.context.workspaceState.get<Record<string, string>>('lhp.pipelineConfigs', {});
  await host.context.workspaceState.update('lhp.pipelineConfigs', {
    ...map,
    [project.summary.id]: selected.path,
  });
  host.invalidateContext();
  await host.refreshResources();
  await host.refresh();
}
