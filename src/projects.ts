import * as path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { pythonInVenv } from './onboardingProcess';
import * as vscode from 'vscode';
import { BridgeClient } from './bridgeClient';
import { record } from './catalog';
import type { ProjectSummary, RuntimeInfo } from './shared/protocol';
import { isRecord } from './shared/guards';

export interface Project {
  root: string;
  summary: ProjectSummary;
}
export async function discoverProjects(): Promise<Project[]> {
  const files = await vscode.workspace.findFiles(
    '**/lhp.yaml',
    '**/{node_modules,.venv,venv,.git,generated,.tmp}/**',
    200,
  );
  return files
    .filter((uri) => uri.scheme === 'file')
    .map((uri) => {
      const root = path.dirname(uri.fsPath);
      return {
        root,
        summary: {
          id: vscode.Uri.file(root).toString(),
          name: path.basename(root),
          rootLabel: vscode.workspace.asRelativePath(root, true),
        },
      };
    })
    .sort((a, b) => a.root.localeCompare(b.root));
}
export async function resolveInterpreter(
  project: Project,
  context: vscode.ExtensionContext,
): Promise<string> {
  const mapped = context.workspaceState.get<Record<string, string>>('lhp.interpreters', {})[
    project.summary.id
  ];
  const configured = vscode.workspace
    .getConfiguration('lhp', vscode.Uri.file(project.root))
    .get<string>('pythonPath');
  if (mapped || configured) return mapped || configured!;
  const local = path.join(
    project.root,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  try {
    await access(local);
    return local;
  } catch {
    /* Next candidate. */
  }
  const extension = vscode.extensions.getExtension<unknown>('ms-python.python');
  if (extension) {
    try {
      const api: unknown = extension.isActive ? extension.exports : await extension.activate();
      if (
        isRecord(api) &&
        isRecord(api.environments) &&
        typeof api.environments.getActiveEnvironmentPath === 'function'
      ) {
        const active: unknown = api.environments.getActiveEnvironmentPath(
          vscode.Uri.file(project.root),
        );
        if (isRecord(active) && typeof active.path === 'string' && active.path) {
          const info = await stat(active.path);
          return info.isDirectory() ? pythonInVenv(active.path) : active.path;
        }
      }
    } catch {
      /* Optional Python extension unavailable. */
    }
  }
  return (
    context.globalState.get<string>('defaultInterpreter') ??
    (process.platform === 'win32' ? 'python' : 'python3')
  );
}

export async function inspectRuntime(
  project: Project,
  context: vscode.ExtensionContext,
  bridge: BridgeClient,
  signal?: AbortSignal,
): Promise<RuntimeInfo> {
  const interpreter = await resolveInterpreter(project, context);
  try {
    return {
      ...record(await bridge.call({ operation: 'health', interpreter, signal, timeoutMs: 15000 })),
      interpreter,
    } as unknown as RuntimeInfo;
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      interpreter,
      compatible: false,
      capabilities: [],
      message: error instanceof Error ? error.message : 'Python is unavailable.',
    };
  }
}
