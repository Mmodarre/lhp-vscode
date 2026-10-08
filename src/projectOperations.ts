import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Controller } from './controller';
import type { Project } from './projects';
import { record, items, text } from './catalog';
import { validationDiagnostics } from './validation';
import { containedPath } from './paths';
import type { JsonObject, PreviewResult, WebviewRequest } from './shared/protocol';
import { stringify } from 'yaml';

export async function operate(
  host: Controller,
  operation: 'validate' | 'preview' | 'generate',
): Promise<void> {
  const project = host.requireProject();
  if (!host.snapshot?.context.runtime.compatible)
    throw new Error('Select a compatible LHP interpreter first.');
  if (operation === 'generate') {
    const currentContext = bindContext(host, project);
    const assertContext = () => {
      if (!currentContext())
        throw new Error(
          'Project, environment or Python configuration changed. Review full generation again.',
        );
    };
    const decision = await vscode.window.showWarningMessage(
      `Generate the full project for ${host.environment(project)}? This replaces this environment's configured generated output and updates enabled bundle resources. All open project documents will be saved first. This does not run or deploy to Databricks.`,
      { modal: true },
      'Save and generate full project',
    );
    if (!decision) return;
    assertContext();
    for (const document of vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && host.ownsUri(d.uri),
    )) {
      assertContext();
      if (!(await document.save()))
        throw new Error('Generation cancelled because a project document could not be saved.');
      assertContext();
    }
    clearTimeout(host.timer);
    await host.refresh();
    assertContext();
    if (host.snapshot?.stale || host.snapshot?.diagnostics.some((d) => d.severity === 'error'))
      throw new Error('Resolve project source errors before generation.');
  }
  if (operation === 'generate') await generateSavedProject(host);
  else await performOperation(host, operation);
}
/** Called only after the command's one explicit confirmation and save step. */
export async function generateSavedProject(host: Controller): Promise<void> {
  host.requireProject();
  if (vscode.workspace.textDocuments.some((d) => d.isDirty && host.ownsUri(d.uri)))
    throw new Error('Save project documents before generation.');
  if (
    !host.snapshot?.context.runtime.compatible ||
    (host.snapshot.refreshState && host.snapshot.refreshState !== 'ready') ||
    host.snapshot.stale ||
    host.snapshot.diagnostics.some((d) => d.severity === 'error')
  )
    throw new Error('Refresh and resolve source errors before generation.');
  await performOperation(host, 'generate');
}
async function performOperation(
  host: Controller,
  operation: 'validate' | 'preview' | 'generate',
): Promise<void> {
  const project = host.requireProject();
  if (!host.snapshot?.context.runtime.compatible)
    throw new Error('Select a compatible LHP interpreter first.');
  const epoch = host.epoch;
  const runtime = host.snapshot.context.runtime;
  await host.run(operation, async (signal) => {
    const response = await host.call(operation, project, runtime, signal);
    if (signal.aborted || epoch !== host.epoch || project !== host.project) return;
    if (operation === 'validate') {
      const diagnostics = validationDiagnostics(response, host.snapshot!, project.root);
      host.snapshot = { ...host.snapshot!, diagnostics };
      host.panel.post({ type: 'diagnostics', diagnostics });
      await host.problems.update(
        project.root,
        diagnostics,
        () => epoch === host.epoch && project === host.project,
      );
      void vscode.window.showInformationMessage(
        `LHP validation: ${record(response).success === true ? 'passed' : 'found issues'}.`,
      );
    } else if (operation === 'preview') {
      const result: PreviewResult = {
        files: items(record(response).files).map((v) => {
          const file = record(v);
          return {
            path: text(file.path),
            content: text(file.content),
            kind: text(file.kind),
            pipeline: text(file.pipeline),
          };
        }),
        parity: 'source-only',
        documentVersions: Object.fromEntries(
          (host.snapshot?.documents ?? []).map((d) => [d.path, d.version]),
        ),
        notices: [
          'Read-only generated source preview includes current editor drafts. Bundle synchronisation, monitoring finalisation and sandbox generation are not represented. Wheel mode is unsupported in preview. Use explicit full-project generation for deployable output.',
        ],
      };
      host.previews.set(result);
      host.panel.post({ type: 'preview', result });
      if (result.files[0]) await host.previews.show(result.files[0].path);
    } else {
      if (record(response).success === false)
        throw new Error(text(record(response).error_message, 'Generation failed.'));
      await host.workspace.recordGeneration(response);
      void vscode.window.showInformationMessage(
        'LHP full-project generation completed. Open the Databricks bundle for deployment.',
      );
    }
  });
  if (operation === 'generate' && !host.isOperating) {
    await host.refreshResources();
    await host.refresh();
  }
}
export async function databricks(host: Controller): Promise<void> {
  const project = host.requireProject();
  const uri = vscode.Uri.file(await containedPath(project.root, 'databricks.yml'));
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    throw new Error(
      'This project has no databricks.yml. Create a project with bundle support or enable the bundle with LHP.',
    );
  }
  await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
  const extension = vscode.extensions.getExtension('databricks.databricks');
  if (!extension)
    await vscode.commands.executeCommand(
      'workbench.extensions.search',
      '@id:databricks.databricks',
    );
  else
    void vscode.window.showInformationMessage(
      'Use the Databricks extension to select your workspace and bundle target, validate, deploy and run.',
    );
}
export async function scaffold(
  host: Controller,
  request: Extract<WebviewRequest, { type: 'createBronze' | 'createInstance' }>,
): Promise<void> {
  const project = host.requireProject();
  const snapshot = host.snapshot!;
  const currentContext = bindContext(host, project);
  const epoch = host.epoch;
  const values = request.values;
  const filename =
    request.type === 'createInstance' ? request.values.targetPath : `pipelines/${values.name}.yaml`;
  if (!filename.endsWith('.yaml') && !filename.endsWith('.yml'))
    throw new Error('Create an instance in a YAML file.');
  const uri = vscode.Uri.file(await containedPath(project.root, filename));
  if (!host.ownsUri(uri)) throw new Error('Choose a target owned by the selected LHP project.');
  const options: JsonObject =
    request.type === 'createInstance'
      ? { ...request.values, reference: request.values.definition }
      : { ...request.values, kind: 'bronze' };
  await host.run('create', async (signal) => {
    const result = record(
      await host.call('scaffold', project, snapshot.context.runtime, signal, options),
    );
    if (epoch !== host.epoch || signal.aborted) return;
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    if (epoch !== host.epoch || signal.aborted) return;
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    edit.insert(uri, new vscode.Position(0, 0), text(result.content));
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error(
        'The target already exists or VS Code could not create it. Choose a new file.',
      );
    host.lastEdited = uri;
    await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });
  });
  await refreshAuthoredProject(host, currentContext);
}

/** New-file creation only; existing YAML is always edited with versioned CST edits. */
export async function createFlowgroup(
  host: Controller,
  values: { name: string; pipeline: string; targetPath: string },
): Promise<void> {
  const project = host.requireProject();
  const currentContext = bindContext(host, project);
  if (!values.name.trim() || !values.pipeline.trim() || !/\.ya?ml$/i.test(values.targetPath))
    throw new Error('A flowgroup name, pipeline and new YAML path are required.');
  const epoch = host.epoch;
  const uri = vscode.Uri.file(await containedPath(project.root, values.targetPath));
  if (!host.ownsUri(uri)) throw new Error('Choose a target owned by the selected LHP project.');
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
  if (epoch !== host.epoch || project !== host.project)
    throw new Error('Project changed while creating the flowgroup.');
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
  edit.insert(
    uri,
    new vscode.Position(0, 0),
    stringify({ pipeline: values.pipeline, flowgroup: values.name, actions: [] }),
  );
  if (!(await vscode.workspace.applyEdit(edit)))
    throw new Error('Choose a new YAML path; the target may already exist.');
  host.lastEdited = uri;
  await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
  await refreshAuthoredProject(host, currentContext);
  if (
    project === host.project &&
    host.snapshot?.context.runtime.compatible &&
    host.snapshot.refreshState === 'ready' &&
    !host.snapshot.flowgroups.some((group) => group.source.path === values.targetPath)
  )
    void vscode.window.showWarningMessage(
      `Created ${values.targetPath}, but LHP did not discover a flowgroup there. Check the include patterns in lhp.yaml and source diagnostics, then Refresh. The native YAML document remains available to edit.`,
    );
}

/** Native creation can emit its filesystem event after the edit promise settles.
 * Retry only when a newer source revision superseded this refresh; user Cancel
 * at the same revision remains cancelled instead of restarting work. */
async function refreshAuthoredProject(
  host: Controller,
  currentContext: () => boolean,
): Promise<void> {
  if (!currentContext()) return;
  await host.refreshResources();
  for (let attempt = 0; attempt < 3 && currentContext(); attempt++) {
    clearTimeout(host.timer);
    const revision = host.epoch;
    await host.refresh();
    if (host.epoch === revision) return;
  }
  if (currentContext())
    void vscode.window.showWarningMessage(
      'The YAML draft was created, but source kept changing during refresh. Refresh the graph when ready.',
    );
}

function bindContext(host: Controller, project: Project): () => boolean {
  const environment = host.environment(project);
  const configuration = host.activePipelineConfig(project);
  const interpreter = (host.runtime ?? host.snapshot?.context.runtime)?.interpreter;
  return () =>
    project === host.project &&
    environment === host.environment(project) &&
    configuration === host.activePipelineConfig(project) &&
    interpreter === (host.runtime ?? host.snapshot?.context.runtime)?.interpreter;
}
