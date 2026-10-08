import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Controller } from './controller';
import { record, items, text } from './catalog';
import { validationDiagnostics } from './validation';
import { containedPath, relativePath } from './paths';
import type { JsonObject, PreviewResult, WebviewRequest } from './shared/protocol';

export async function operate(
  host: Controller,
  operation: 'validate' | 'preview' | 'generate',
): Promise<void> {
  const project = host.requireProject();
  if (!host.snapshot?.context.runtime.compatible)
    throw new Error('Select a compatible LHP interpreter first.');
  if (operation === 'generate') {
    const decision = await vscode.window.showWarningMessage(
      `Generate the full project for ${host.environment(project)}? This replaces this environment's configured generated output and updates enabled bundle resources. All open project documents will be saved first. This does not run or deploy to Databricks.`,
      { modal: true },
      'Save and generate full project',
    );
    if (!decision) return;
    for (const document of vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && d.uri.scheme === 'file' && relativePath(project.root, d.uri.fsPath),
    ))
      if (!(await document.save()))
        throw new Error('Generation cancelled because a project document could not be saved.');
    clearTimeout(host.timer);
    await host.refresh();
    if (host.snapshot?.stale || host.snapshot?.diagnostics.some((d) => d.severity === 'error'))
      throw new Error('Resolve project source errors before generation.');
  }
  if (operation === 'generate') await generateSavedProject(host);
  else await performOperation(host, operation);
}
/** Called only after the command's one explicit confirmation and save step. */
export async function generateSavedProject(host: Controller): Promise<void> {
  const project = host.requireProject();
  if (
    vscode.workspace.textDocuments.some(
      (d) => d.isDirty && d.uri.scheme === 'file' && relativePath(project.root, d.uri.fsPath),
    )
  )
    throw new Error('Save project documents before generation.');
  if (
    !host.snapshot?.context.runtime.compatible ||
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
      void vscode.window.showInformationMessage(
        'LHP full-project generation completed. Open the Databricks bundle for deployment.',
      );
    }
  });
  if (operation === 'generate') await host.refresh();
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
  const epoch = host.epoch;
  const values = request.values;
  const filename =
    request.type === 'createInstance' ? request.values.targetPath : `pipelines/${values.name}.yaml`;
  if (!filename.endsWith('.yaml') && !filename.endsWith('.yml'))
    throw new Error('Create an instance in a YAML file.');
  const uri = vscode.Uri.file(await containedPath(project.root, filename));
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
  await host.refresh();
}
