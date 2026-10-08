import * as path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { BridgeClient } from './bridgeClient';
import { isRecord } from './shared/guards';
import { assertEmptyTarget, bootstrapProject, isSupportedPython, pythonInVenv, REVIEWED_LHP_SOURCE, runPythonCommand } from './onboardingProcess';

const INTERPRETERS_KEY = 'lhp.interpreters';
const DEFAULT_INTERPRETER_KEY = 'defaultInterpreter';

interface Candidate { label: string; path: string; detail: string }
type InterpreterPick = vscode.QuickPickItem & { path?: string; action?: 'browse' | 'setup' };

function requireTrust(): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage('Trust this workspace before running Python, creating a project, or installing LHP.');
  return false;
}

async function existingPython(value: string): Promise<string | undefined> {
  if (!value.trim()) return undefined;
  if (!path.isAbsolute(value)) return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) ? value : undefined;
  try {
    const info = await stat(value);
    if (info.isFile()) return value;
    if (info.isDirectory()) {
      for (const candidate of [pythonInVenv(value), path.join(value, 'bin', 'python3')]) {
        try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* Keep checking. */ }
      }
    }
  } catch { /* A stale setting is omitted from the picker. */ }
  return undefined;
}

/** The Python extension API is optional; its active path can be a folder. */
async function pythonExtensionSelection(projectRoot?: string): Promise<string | undefined> {
  const extension = vscode.extensions.getExtension<unknown>('ms-python.python');
  if (!extension) return undefined;
  try {
    const api: unknown = extension.isActive ? extension.exports : await extension.activate();
    if (!isRecord(api) || !isRecord(api.environments)) return undefined;
    const get = api.environments.getActiveEnvironmentPath;
    if (typeof get !== 'function') return undefined;
    const active: unknown = get(projectRoot ? vscode.Uri.file(projectRoot) : undefined);
    if (!isRecord(active) || typeof active.path !== 'string') return undefined;
    return existingPython(active.path);
  } catch { return undefined; }
}

async function candidates(projectRoot: string | undefined, context: vscode.ExtensionContext): Promise<Candidate[]> {
  const resource = projectRoot ? vscode.Uri.file(projectRoot) : undefined;
  const configured = vscode.workspace.getConfiguration('lhp', resource).get<string>('pythonPath');
  const mapped = projectRoot ? context.workspaceState.get<Record<string, string>>(INTERPRETERS_KEY, {})[resource!.toString()] : undefined;
  const pythonSetting = vscode.workspace.getConfiguration('python', resource).get<string>('defaultInterpreterPath');
  const active = await pythonExtensionSelection(projectRoot);
  const raw: Candidate[] = [
    ...(mapped ? [{ label: 'LHP project interpreter', path: mapped, detail: 'Saved for this LHP project' }] : []),
    ...(configured ? [{ label: 'LHP setting', path: configured, detail: 'lhp.pythonPath' }] : []),
    ...(projectRoot ? [{ label: 'Project .venv', path: pythonInVenv(path.join(projectRoot, '.venv')), detail: 'Existing virtual environment' }] : []),
    ...(active ? [{ label: 'Python extension selection', path: active, detail: 'Active Python environment' }] : []),
    ...(pythonSetting ? [{ label: 'Python extension setting', path: pythonSetting, detail: 'python.defaultInterpreterPath' }] : []),
    ...(context.globalState.get<string>(DEFAULT_INTERPRETER_KEY) ? [{ label: 'Previously selected Python', path: context.globalState.get<string>(DEFAULT_INTERPRETER_KEY)!, detail: 'Extension default' }] : []),
    { label: 'Python on PATH', path: process.platform === 'win32' ? 'python' : 'python3', detail: 'System command' },
  ];
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const resolved = await existingPython(item.path);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    found.push({ ...item, path: resolved });
  }
  return found;
}

async function browsePython(): Promise<string | undefined> {
  const chosen = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false,
    openLabel: 'Choose Python executable or environment folder', title: 'Select Python for Lakehouse Plumber' });
  return chosen?.[0] ? existingPython(chosen[0].fsPath) : undefined;
}

async function health(interpreter: string, bridge: BridgeClient): Promise<{ compatible: boolean; version?: string; message?: string }> {
  try {
    const result = await bridge.call({ operation: 'health', interpreter, timeoutMs: 12_000 });
    if (!isRecord(result)) return { compatible: false, message: 'Python did not return a valid LHP health report.' };
    const version = typeof result.pythonVersion === 'string' ? result.pythonVersion : undefined;
    return { compatible: result.compatible === true && !!version && isSupportedPython(version), version,
      message: typeof result.message === 'string' ? result.message : undefined };
  } catch { return { compatible: false, message: 'Could not start this Python interpreter or query LHP.' }; }
}

async function persistInterpreter(projectRoot: string | undefined, context: vscode.ExtensionContext, interpreter: string): Promise<void> {
  if (!projectRoot) { await context.globalState.update(DEFAULT_INTERPRETER_KEY, interpreter); return; }
  const key = vscode.Uri.file(projectRoot).toString();
  const map = context.workspaceState.get<Record<string, string>>(INTERPRETERS_KEY, {});
  await context.workspaceState.update(INTERPRETERS_KEY, { ...map, [key]: interpreter });
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
  if (folder && path.resolve(folder.uri.fsPath) === path.resolve(projectRoot)) {
    await vscode.workspace.getConfiguration('lhp', folder.uri).update('pythonPath', interpreter, vscode.ConfigurationTarget.WorkspaceFolder);
  }
}

/** Pick a compatible existing LHP interpreter, or launch guided local setup. */
export async function selectInterpreter(projectRoot: string | undefined, context: vscode.ExtensionContext, bridge: BridgeClient): Promise<string | undefined> {
  if (!requireTrust()) return undefined;
  const options: InterpreterPick[] = (await candidates(projectRoot, context)).map((item) => ({ label: item.label, description: item.path, detail: item.detail, path: item.path }));
  options.push({ label: 'Browse for Python…', action: 'browse', detail: 'Choose an executable or virtual environment folder' });
  options.push({ label: 'Set up a new LHP environment…', action: 'setup', detail: 'Create a virtual environment and install a compatible integration build' });
  const chosen = await vscode.window.showQuickPick(options, { title: 'Select LHP Python interpreter', placeHolder: 'Choose a compatible LHP 0.9.3 integration environment' });
  if (!chosen) return undefined;
  if (chosen.action === 'setup') return setupEnvironment(projectRoot, context, bridge);
  const interpreter = chosen.action === 'browse' ? await browsePython() : chosen.path;
  if (!interpreter) return undefined;
  const report = await health(interpreter, bridge);
  if (!report.compatible) {
    const next = await vscode.window.showWarningMessage(report.message ?? 'This Python does not have the LHP editor integration APIs.', 'Set up environment', 'Choose another');
    if (next === 'Set up environment') return setupEnvironment(projectRoot, context, bridge);
    if (next === 'Choose another') return selectInterpreter(projectRoot, context, bridge);
    return undefined;
  }
  await persistInterpreter(projectRoot, context, interpreter);
  void vscode.window.showInformationMessage(`LHP is ready with Python ${report.version ?? '3.11+'}.`);
  return interpreter;
}

async function basePython(projectRoot: string | undefined, context: vscode.ExtensionContext, bridge: BridgeClient): Promise<string | undefined> {
  const found = await candidates(projectRoot, context);
  const options: InterpreterPick[] = found.map((item) => ({ label: item.label, description: item.path, detail: item.detail, path: item.path }));
  options.push({ label: 'Browse for Python…', action: 'browse' });
  for (;;) {
    const picked = await vscode.window.showQuickPick(options, { title: 'Choose base Python for a new .venv', placeHolder: 'Python 3.11 or newer' });
    if (!picked) return undefined;
    const interpreter = picked.action === 'browse' ? await browsePython() : picked.path;
    if (!interpreter) continue;
    const report = await health(interpreter, bridge);
    if (report.version && isSupportedPython(report.version)) return interpreter;
    void vscode.window.showWarningMessage(`Python 3.11 or newer is required. Selected interpreter reported ${report.version ?? 'an unknown version'}.`);
  }
}

async function installSpec(): Promise<string | undefined> {
  const options: (vscode.QuickPickItem & { installKind: 'git' | 'local' })[] = [];
  if (REVIEWED_LHP_SOURCE) options.push({ label: 'Recommended reviewed LHP integration build', installKind: 'git', detail: 'Pinned Git commit; installs only into the new .venv' });
  options.push({ label: 'Local LHP wheel or source checkout', installKind: 'local', detail: 'Choose a compatible build you already trust' });
  const selected = await vscode.window.showQuickPick(options, { title: 'Install the LHP editor integration', placeHolder: 'An unreleased integration build is required; standard PyPI 0.9.2 is insufficient' });
  if (!selected) return undefined;
  if (selected.installKind === 'git') return REVIEWED_LHP_SOURCE;
  const chosen = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false,
    openLabel: 'Choose LHP wheel or source folder', title: 'Select a compatible LHP integration build', filters: { 'Python wheel': ['whl'] } });
  return chosen?.[0]?.fsPath;
}

/** The picker supplies a parent and a new child name, so an alternate target need not exist yet. */
async function chooseEnvironmentTarget(): Promise<string | undefined> {
  const parent = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: 'Choose parent folder', title: 'Create LHP environment in another folder' });
  if (!parent?.[0]) return undefined;
  const name = await vscode.window.showInputBox({ title: 'Environment folder name', value: 'lhp-venv',
    prompt: 'A new empty folder will be created inside the selected parent',
    validateInput: (value) => validFolderName(value) ? undefined : 'Use a single folder name with letters, numbers, dots, underscores, or hyphens.' });
  return name ? path.join(parent[0].fsPath, name) : undefined;
}

/** Create a project .venv, or an extension-owned bootstrap venv before a project exists. */
export async function setupEnvironment(projectRoot: string | undefined, context: vscode.ExtensionContext, bridge: BridgeClient): Promise<string | undefined> {
  if (!requireTrust()) return undefined;
  let envRoot = projectRoot ? path.join(projectRoot, '.venv') : path.join(context.globalStorageUri.fsPath, 'bootstrap-venv');
  for (;;) {
    const existing = await existingPython(envRoot);
    let repair = false;
    if (existing) {
      const report = await health(existing, bridge);
      const options: (vscode.QuickPickItem & { value: 'use' | 'repair' | 'other' })[] = [
        ...(report.compatible ? [{ label: 'Use this compatible environment', value: 'use' as const, detail: existing }] : []),
        { label: 'Install or repair LHP in this environment', value: 'repair', detail: 'Explicitly change packages in this existing environment' },
        { label: 'Create an environment in another folder', value: 'other', detail: 'Keep this environment untouched' },
      ];
      const choice = await vscode.window.showQuickPick(options, { title: `Environment exists at ${envRoot}`,
        placeHolder: report.compatible ? 'Choose how to continue' : (report.message ?? 'This environment does not provide the required LHP integration') });
      if (!choice) return undefined;
      if (choice.value === 'use') { await persistInterpreter(projectRoot, context, existing); return existing; }
      if (choice.value === 'other') { const other = await chooseEnvironmentTarget(); if (!other) return undefined; envRoot = other; continue; }
      repair = true;
    } else {
      try { await assertEmptyTarget(envRoot); }
      catch {
        const choice = await vscode.window.showWarningMessage(`The environment folder ${envRoot} contains files but no working Python executable. Its contents will be kept.`, 'Choose another folder');
        if (choice !== 'Choose another folder') return undefined;
        const other = await chooseEnvironmentTarget();
        if (!other) return undefined;
        envRoot = other;
        continue;
      }
    }
    const source = await installSpec();
    if (!source) {
      if (!REVIEWED_LHP_SOURCE) void vscode.window.showInformationMessage('The reviewed Git commit is not published yet. Select a compatible local wheel or source checkout.');
      return undefined;
    }
    const base = repair ? undefined : await basePython(projectRoot, context, bridge);
    if (!repair && !base) return undefined;
    const location = repair ? envRoot : path.dirname(envRoot);
    await mkdir(location, { recursive: true });
    const python = existing ?? pythonInVenv(envRoot);
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Setting up LHP Python environment', cancellable: true }, async (progress, cancellation) => {
        const controller = new AbortController();
        const subscription = cancellation.onCancellationRequested(() => controller.abort());
        try {
          if (!repair && base) {
            progress.report({ message: 'Creating virtual environment' });
            await runPythonCommand(base, ['-m', 'venv', envRoot], location, controller.signal);
          }
          progress.report({ message: 'Installing the selected LHP integration build' });
          await runPythonCommand(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', source], location, controller.signal);
        } finally { subscription.dispose(); }
      });
      const report = await health(python, bridge);
      if (!report.compatible) throw new Error(report.message ?? 'The installed LHP build does not expose the required editor APIs.');
      await persistInterpreter(projectRoot, context, python);
      void vscode.window.showInformationMessage(`LHP Python environment is ready at ${envRoot}.`);
      return python;
    } catch (error) {
      const choice = await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Environment setup failed.', 'Retry setup', 'Choose another folder');
      if (choice === 'Retry setup') continue;
      if (choice !== 'Choose another folder') return undefined;
      const other = await chooseEnvironmentTarget();
      if (!other) return undefined;
      envRoot = other;
    }
  }
}

function validFolderName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.' && name !== '..';
}

/** Bootstrap only an explicitly selected absent or empty target. The caller attaches the new root. */
export async function createProject(context: vscode.ExtensionContext, bridge: BridgeClient, interpreter?: string): Promise<string | undefined> {
  if (!requireTrust()) return undefined;
  const selectedPython = interpreter ?? await selectInterpreter(undefined, context, bridge);
  if (!selectedPython) return undefined;
  const mode = await vscode.window.showQuickPick([
    { label: 'Create a new project folder', value: 'new' },
    { label: 'Use an existing empty folder', value: 'empty' },
  ], { title: 'Create LHP project', placeHolder: 'The target must be empty; no existing files will be overwritten' });
  if (!mode) return undefined;
  let root: string | undefined;
  let projectName: string | undefined;
  if (mode.value === 'new') {
    const parent = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Choose parent folder' });
    if (!parent?.[0]) return undefined;
    projectName = await vscode.window.showInputBox({ title: 'New LHP project folder', prompt: 'Enter a project folder name',
      validateInput: (value) => validFolderName(value) ? undefined : 'Use letters, numbers, dots, underscores, or hyphens; no separators.' });
    if (!projectName) return undefined;
    root = path.join(parent[0].fsPath, projectName);
  } else {
    const target = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Choose empty project folder' });
    if (!target?.[0]) return undefined;
    root = target[0].fsPath;
    projectName = path.basename(root);
  }
  try { await assertEmptyTarget(root); }
  catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : 'Choose an empty project folder.'); return undefined; }
  const bundle = await vscode.window.showQuickPick([
    { label: 'Include Databricks bundle scaffolding', value: true, detail: 'Recommended for later Databricks handoff' },
    { label: 'LHP project files only', value: false, detail: 'Add a bundle later if needed' },
  ], { title: 'Project scaffolding' });
  if (!bundle) return undefined;
  try {
    await bootstrapProject(root, projectName, bundle.value, selectedPython, bridge);
    try { await persistInterpreter(root, context, selectedPython); }
    catch { void vscode.window.showWarningMessage('Project files were created, but the Python selection could not be saved. Select the interpreter for this project before editing.'); }
    void vscode.window.showInformationMessage(`Created LHP project ${projectName}.`);
    return root;
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Project initialization failed.');
    return undefined;
  }
}
