import * as vscode from 'vscode';
import type { Controller } from './controller';
import { items, record, text } from './catalog';
import { containedPath } from './paths';
import { resolveResource } from './resourceActions';
import { normalizeDatasets } from './datasets';
import type {
  InspectionRequest,
  JsonObject,
  JsonValue,
  TemplateDefinition,
} from './shared/protocol';

async function sampleParameters(definition?: TemplateDefinition): Promise<JsonObject | undefined> {
  const result: JsonObject = {};
  for (const field of definition?.fields ?? []) {
    let value: string | undefined;
    if (field.choices?.length || field.type === 'boolean')
      value = await vscode.window.showQuickPick((field.choices ?? [true, false]).map(String), {
        title: `Template sample: ${field.label}`,
      });
    else
      value = await vscode.window.showInputBox({
        title: `Template sample: ${field.label}`,
        prompt: field.description ?? `${field.type}${field.required ? ', required' : ', optional'}`,
        value:
          field.default === undefined
            ? ''
            : typeof field.default === 'string'
              ? field.default
              : JSON.stringify(field.default),
        validateInput: (input) => {
          if (!input && field.required) return 'A sample value is required.';
          if (input && field.type === 'number' && !Number.isFinite(Number(input)))
            return 'Enter a number.';
          if (input && ['object', 'array'].includes(field.type)) {
            try {
              const value = JSON.parse(input) as unknown;
              if (
                field.type === 'array'
                  ? !Array.isArray(value)
                  : !value || typeof value !== 'object' || Array.isArray(value)
              )
                return `Enter a JSON ${field.type}.`;
            } catch {
              return `Enter a JSON ${field.type}.`;
            }
          }
          return undefined;
        },
      });
    if (value === undefined) return undefined;
    if (!value && !field.required) continue;
    result[field.name] = ['object', 'array'].includes(field.type)
      ? (JSON.parse(value) as JsonValue)
      : field.type === 'number'
        ? Number(value)
        : field.type === 'boolean'
          ? value === 'true'
          : value;
  }
  return result;
}

export async function inspectResource(host: Controller, request: InspectionRequest): Promise<void> {
  const project = host.requireProject();
  const resource = resolveResource(host, request.resourceId);
  const runtime = host.runtime ?? host.snapshot?.context.runtime;
  if (!runtime?.compatible)
    throw new Error(
      'Select a compatible LHP interpreter before inspection. Source browsing remains available.',
    );
  const epoch = host.epoch;
  const options: JsonObject = { kind: request.kind, path: resource.path, name: resource.name };
  const notices = [
    `Project: ${project.summary.name}. Environment: ${host.environment(project)}. Read-only inspection.`,
  ];
  if (request.kind === 'template') {
    if (resource.kind !== 'template') throw new Error('Select an LHP flow template.');
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(await containedPath(project.root, resource.path)),
    );
    options.sourceYaml = document.getText();
    options.stage =
      request.stage ??
      (await vscode.window.showQuickPick(['inspect', 'expanded', 'resolved'], {
        title: 'Template preview stage',
      })) ??
      '';
    if (!options.stage) return;
    if (options.stage !== 'inspect') {
      const parameters = await sampleParameters(
        host.catalog?.templates.find((t) => t.source.path === resource.path),
      );
      if (!parameters) return;
      options.parameters = parameters;
    }
    notices.push(
      'Uses this template draft and saved dependencies. Rendering is bounded by the installed LHP API; no files are generated.',
    );
  } else
    notices.push(
      'Saved files only. Unsaved edits are not included; this is not a deployable generated result.',
    );
  if (epoch !== host.epoch || project !== host.project)
    throw new Error('Project changed while preparing inspection. Retry with the current source.');
  await host.run('inspect', async (signal) => {
    let result = await host.call('inspect', project, runtime, signal, options);
    if (signal.aborted || epoch !== host.epoch || project !== host.project) return;
    const targets = items(record(result).targets).filter(
      (value): value is string => typeof value === 'string',
    );
    if (targets.length > 1) {
      const target = await vscode.window.showQuickPick(targets, {
        title: 'Configuration target to inspect',
      });
      if (!target) return;
      signal.throwIfAborted();
      if (epoch !== host.epoch || project !== host.project) return;
      result = await host.call('inspect', project, runtime, signal, { ...options, target });
    }
    if (signal.aborted || epoch !== host.epoch || project !== host.project) return;
    await host.inspections.show(`${request.kind}: ${resource.name}`, result, [
      ...notices,
      ...items(record(result).warnings).map((warning) => text(warning)),
    ]);
  });
}

export async function loadData(host: Controller): Promise<void> {
  const project = host.requireProject();
  if (
    !host.snapshot?.context.runtime.compatible ||
    host.snapshot.stale ||
    host.snapshot.refreshState !== 'ready'
  )
    await host.refresh();
  if (project !== host.project) return;
  const snapshot = host.snapshot;
  if (!snapshot?.context.runtime.compatible || snapshot.stale || snapshot.refreshState !== 'ready')
    throw new Error('Refresh and resolve source errors before inspecting current data lineage.');
  const epoch = host.epoch;
  await host.run('data', async (signal) => {
    const response = await host.call('data', project, snapshot.context.runtime, signal);
    if (signal.aborted || epoch !== host.epoch || project !== host.project) return;
    host.workspace.datasets = normalizeDatasets(project.root, response, snapshot);
    host.panel.post({ type: 'datasets', datasets: host.workspace.datasets });
    host.notifyState();
  });
}

export async function compareGenerated(host: Controller, id: string): Promise<void> {
  const resource = resolveResource(host, id);
  if (resource.kind !== 'generated' || resource.generatedKind !== 'source')
    throw new Error(
      'Select generated source output. Bundle files and wheels are not included in source preview.',
    );
  const project = host.readProject();
  if (resource.environment !== host.environment(project))
    throw new Error(
      'Select generated output for the active preview environment. Previews from another environment cannot be compared.',
    );
  const relative = resource.path.replace(/^generated\/[^/]+\//, '');
  const preview = host.previews.uri(relative);
  if (!preview)
    throw new Error(
      'Run Preview Generated Source for this environment first. Only matching source previews can be compared.',
    );
  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(await containedPath(project.root, resource.path)),
    preview,
    `LHP: generated ↔ draft (${relative})`,
  );
}
