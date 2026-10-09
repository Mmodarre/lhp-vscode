import * as path from 'node:path';
import * as vscode from 'vscode';
import { isMap, parseDocument, stringify } from 'yaml';
import type { Controller } from './controller';
import { containedPath, SANDBOX_PROFILE_PATH } from './paths';

const NAMESPACE = /^[a-z][a-z0-9_]{0,63}$/;

/** Guide only edits the native canonical profile; undo and dirty state stay in VS Code. */
export async function configureSandboxProfile(host: Controller): Promise<void> {
  const project = host.requireProject();
  const epoch = host.epoch;
  const uri = vscode.Uri.file(await containedPath(project.root, SANDBOX_PROFILE_PATH));
  let exists = true;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    exists = false;
  }
  const document = exists ? await vscode.workspace.openTextDocument(uri) : undefined;
  const version = document?.version;
  if (document) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Open profile YAML', detail: 'Edit the native file directly', guided: false },
        {
          label: 'Guided namespace and pipelines',
          detail: 'Apply one native, undoable YAML edit',
          guided: true,
        },
      ],
      { title: 'Configure sandbox profile' },
    );
    if (!choice) return;
    if (!choice.guided) {
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active });
      return;
    }
  }
  const parsed = document
    ? parseDocument(document.getText(), { keepSourceTokens: true })
    : undefined;
  if (parsed?.errors.length || (parsed?.contents && !isMap(parsed.contents))) {
    await vscode.window.showTextDocument(document!, { viewColumn: vscode.ViewColumn.Active });
    throw new Error('Fix profile YAML syntax before using the guided editor.');
  }
  const parsedValue: unknown = parsed?.toJS();
  const rootValue =
    parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
      ? (parsedValue as Record<string, unknown>)
      : {};
  if (
    'sandbox' in rootValue &&
    (!rootValue.sandbox ||
      typeof rootValue.sandbox !== 'object' ||
      Array.isArray(rootValue.sandbox))
  ) {
    await vscode.window.showTextDocument(document!, { viewColumn: vscode.ViewColumn.Active });
    throw new Error(
      'The sandbox field must be a YAML mapping. Fix it in the native profile editor.',
    );
  }
  const sandboxValue =
    rootValue.sandbox && typeof rootValue.sandbox === 'object' && !Array.isArray(rootValue.sandbox)
      ? (rootValue.sandbox as Record<string, unknown>)
      : {};
  const previousNamespace =
    typeof sandboxValue.namespace === 'string' ? sandboxValue.namespace : '';
  const previousPatterns = Array.isArray(sandboxValue.pipelines)
    ? sandboxValue.pipelines.filter((value): value is string => typeof value === 'string')
    : [];
  const namespace = await vscode.window.showInputBox({
    title: 'Sandbox namespace',
    value: previousNamespace,
    prompt: 'Lowercase letters, digits and underscores; starts with a letter.',
    validateInput: (value) =>
      NAMESPACE.test(value)
        ? undefined
        : 'Use a lowercase namespace starting with a letter (max 64 characters).',
  });
  if (namespace === undefined) return;
  const names = host.snapshot?.pipelines.map((pipeline) => pipeline.name) ?? [];
  const selected = names.length
    ? await vscode.window.showQuickPick(
        names.map((name) => ({ label: name, picked: previousPatterns.includes(name) })),
        {
          title: 'Pipelines in this sandbox',
          canPickMany: true,
          placeHolder: 'Choose known pipelines; add globs next',
        },
      )
    : [];
  if (selected === undefined) return;
  const custom = await vscode.window.showInputBox({
    title: 'Additional pipeline names or globs',
    prompt: 'Comma-separated, case-sensitive patterns. Leave empty if selected above.',
    value: previousPatterns.filter((name) => !names.includes(name)).join(', '),
  });
  if (custom === undefined) return;
  const patterns = [
    ...new Set([
      ...selected.map((entry) => entry.label),
      ...custom
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ]),
  ];
  if (!patterns.length) throw new Error('Select at least one pipeline or enter a glob.');
  if (project !== host.project || epoch !== host.epoch || !vscode.workspace.isTrusted)
    throw new Error('Project, source or trust changed while configuring the profile. Retry.');
  if ((await containedPath(project.root, SANDBOX_PROFILE_PATH)) !== uri.fsPath)
    throw new Error('Profile path changed while configuring it. Retry.');
  const edit = new vscode.WorkspaceEdit();
  if (document) {
    if (document.version !== version)
      throw new Error('Profile changed while configuring it. Retry.');
    parsed!.setIn(['sandbox', 'namespace'], namespace);
    parsed!.setIn(['sandbox', 'pipelines'], patterns);
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      String(parsed),
    );
  } else {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    if (project !== host.project || epoch !== host.epoch || !vscode.workspace.isTrusted)
      throw new Error('Project, source or trust changed while configuring the profile. Retry.');
    await containedPath(project.root, SANDBOX_PROFILE_PATH);
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    edit.insert(
      uri,
      new vscode.Position(0, 0),
      stringify({ sandbox: { namespace, pipelines: patterns } }),
    );
  }
  if (!(await vscode.workspace.applyEdit(edit)))
    throw new Error('VS Code could not apply the profile edit. Retry.');
  host.lastEdited = uri;
  await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Active });
  await host.refresh();
}
