import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { BridgeClient } from './bridgeClient';
import { isRecord } from './shared/guards';
import { assertWorkspaceTrust } from './onboardingTrust';
import { isSupportedPython, pythonInVenv } from './onboardingProcess';

const INTERPRETERS_KEY = 'lhp.interpreters';
export const DEFAULT_INTERPRETER_KEY = 'defaultInterpreter';

interface Candidate {
  label: string;
  path: string;
  detail: string;
}
export type InterpreterPick = vscode.QuickPickItem & { path?: string; action?: 'browse' | 'setup' };

export async function existingPython(value: string): Promise<string | undefined> {
  if (!value.trim()) return undefined;
  if (!path.isAbsolute(value)) return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) ? value : undefined;
  try {
    const info = await stat(value);
    if (info.isFile()) return value;
    if (info.isDirectory()) {
      for (const candidate of [pythonInVenv(value), path.join(value, 'bin', 'python3')]) {
        try {
          if ((await stat(candidate)).isFile()) return candidate;
        } catch {
          /* Keep checking. */
        }
      }
    }
  } catch {
    /* A stale setting is omitted from the picker. */
  }
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
  } catch {
    return undefined;
  }
}

export async function candidates(
  projectRoot: string | undefined,
  context: vscode.ExtensionContext,
): Promise<Candidate[]> {
  assertWorkspaceTrust();
  const resource = projectRoot ? vscode.Uri.file(projectRoot) : undefined;
  const configured = vscode.workspace.getConfiguration('lhp', resource).get<string>('pythonPath');
  const mapped = projectRoot
    ? context.workspaceState.get<Record<string, string>>(INTERPRETERS_KEY, {})[resource!.toString()]
    : undefined;
  const pythonSetting = vscode.workspace
    .getConfiguration('python', resource)
    .get<string>('defaultInterpreterPath');
  const active = await pythonExtensionSelection(projectRoot);
  const raw: Candidate[] = [
    ...(mapped
      ? [{ label: 'LHP project interpreter', path: mapped, detail: 'Saved for this LHP project' }]
      : []),
    ...(configured ? [{ label: 'LHP setting', path: configured, detail: 'lhp.pythonPath' }] : []),
    ...(projectRoot
      ? [
          {
            label: 'Project .venv',
            path: pythonInVenv(path.join(projectRoot, '.venv')),
            detail: 'Existing virtual environment',
          },
        ]
      : []),
    ...(active
      ? [{ label: 'Python extension selection', path: active, detail: 'Active Python environment' }]
      : []),
    ...(pythonSetting
      ? [
          {
            label: 'Python extension setting',
            path: pythonSetting,
            detail: 'python.defaultInterpreterPath',
          },
        ]
      : []),
    ...(context.globalState.get<string>(DEFAULT_INTERPRETER_KEY)
      ? [
          {
            label: 'Previously selected Python',
            path: context.globalState.get<string>(DEFAULT_INTERPRETER_KEY)!,
            detail: 'Extension default',
          },
        ]
      : []),
    {
      label: 'Python on PATH',
      path: process.platform === 'win32' ? 'python' : 'python3',
      detail: 'System command',
    },
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

export async function browsePython(): Promise<string | undefined> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose Python executable or environment folder',
    title: 'Select Python for Lakehouse Plumber',
  });
  return chosen?.[0] ? existingPython(chosen[0].fsPath) : undefined;
}

export async function health(
  interpreter: string,
  bridge: BridgeClient,
): Promise<{ compatible: boolean; version?: string; message?: string; capabilities: string[] }> {
  assertWorkspaceTrust();
  try {
    const result = await bridge.call({ operation: 'health', interpreter, timeoutMs: 12_000 });
    if (!isRecord(result))
      return {
        compatible: false,
        message: 'Python did not return a valid LHP health report.',
        capabilities: [],
      };
    const version = typeof result.pythonVersion === 'string' ? result.pythonVersion : undefined;
    return {
      compatible: result.compatible === true && !!version && isSupportedPython(version),
      version,
      message: typeof result.message === 'string' ? result.message : undefined,
      capabilities: Array.isArray(result.capabilities)
        ? result.capabilities.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return {
      compatible: false,
      message: 'Could not start this Python interpreter or query LHP.',
      capabilities: [],
    };
  }
}

export async function persistInterpreter(
  projectRoot: string | undefined,
  context: vscode.ExtensionContext,
  interpreter: string,
  checkContext = assertWorkspaceTrust,
): Promise<void> {
  checkContext();
  if (!projectRoot) {
    await context.globalState.update(DEFAULT_INTERPRETER_KEY, interpreter);
    return;
  }
  const key = vscode.Uri.file(projectRoot).toString();
  const map = context.workspaceState.get<Record<string, string>>(INTERPRETERS_KEY, {});
  await context.workspaceState.update(INTERPRETERS_KEY, { ...map, [key]: interpreter });
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
  checkContext();
  if (folder && path.resolve(folder.uri.fsPath) === path.resolve(projectRoot)) {
    await vscode.workspace
      .getConfiguration('lhp', folder.uri)
      .update('pythonPath', interpreter, vscode.ConfigurationTarget.WorkspaceFolder);
  }
}

export async function basePython(
  projectRoot: string | undefined,
  context: vscode.ExtensionContext,
  bridge: BridgeClient,
  checkContext = assertWorkspaceTrust,
): Promise<string | undefined> {
  checkContext();
  const found = await candidates(projectRoot, context);
  const options: InterpreterPick[] = found.map((item) => ({
    label: item.label,
    description: item.path,
    detail: item.detail,
    path: item.path,
  }));
  options.push({ label: 'Browse for Python…', action: 'browse' });
  for (;;) {
    const picked = await vscode.window.showQuickPick(options, {
      title: 'Choose base Python for a new .venv',
      placeHolder: 'Python 3.11 or newer',
    });
    if (!picked) return undefined;
    const interpreter = picked.action === 'browse' ? await browsePython() : picked.path;
    if (!interpreter) continue;
    checkContext();
    const report = await health(interpreter, bridge);
    if (report.version && isSupportedPython(report.version)) return interpreter;
    void vscode.window.showWarningMessage(
      `Python 3.11 or newer is required. Selected interpreter reported ${report.version ?? 'an unknown version'}.`,
    );
  }
}
