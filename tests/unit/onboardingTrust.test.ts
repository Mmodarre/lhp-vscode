import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { BridgeClient } from '../../src/bridgeClient';

const mocks = vi.hoisted(() => {
  const uri = (value: string) => ({ fsPath: value, toString: () => `file://${value}` });
  return {
    uri,
    workspace: {
      isTrusted: false,
      workspaceFile: undefined,
      workspaceFolders: [{ uri: uri('/workspace') }],
      getWorkspaceFolder: vi.fn(),
      getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
      applyEdit: vi.fn(),
      updateWorkspaceFolders: vi.fn(),
    },
    window: {
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showQuickPick: vi.fn(),
      showOpenDialog: vi.fn(),
      showInputBox: vi.fn(),
      withProgress: vi.fn(),
    },
    executeCommand: vi.fn(),
    runPythonCommand: vi.fn(),
  };
});
vi.mock('vscode', () => ({
  workspace: mocks.workspace,
  window: mocks.window,
  ProgressLocation: { Notification: 1 },
  commands: { executeCommand: mocks.executeCommand },
  Uri: { file: mocks.uri },
  extensions: { getExtension: vi.fn() },
}));
vi.mock('../../src/onboardingProcess', async (original) => ({
  ...(await original<typeof import('../../src/onboardingProcess')>()),
  runPythonCommand: mocks.runPythonCommand,
}));
import { Controller } from '../../src/controller';
import { createProject, selectInterpreter, setupEnvironment } from '../../src/onboarding';
import { health, persistInterpreter } from '../../src/onboardingInterpreter';
import { pythonInVenv, REVIEWED_LHP_SOURCE } from '../../src/onboardingProcess';
import { ensureOnboardingTrust, onboardingContext } from '../../src/onboardingTrust';

describe('onboarding workspace trust', () => {
  let parent: string;
  let context: vscode.ExtensionContext;
  let bridge: BridgeClient;
  let update: ReturnType<typeof vi.fn>;
  let call: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    parent = await mkdtemp(path.join(tmpdir(), 'lhp-trust-'));
    mocks.workspace.isTrusted = false;
    mocks.workspace.workspaceFolders = [{ uri: mocks.uri('/workspace') }];
    mocks.workspace.getConfiguration.mockReturnValue({ get: vi.fn(), update: vi.fn() });
    mocks.window.withProgress.mockImplementation(async (_options, task) =>
      task({ report: vi.fn() }, { onCancellationRequested: () => ({ dispose: vi.fn() }) }),
    );
    update = vi.fn();
    call = vi.fn(async (request: { operation: string }) =>
      request.operation === 'health'
        ? { compatible: true, pythonVersion: '3.11.9' }
        : { success: true },
    );
    bridge = { call } as unknown as BridgeClient;
    context = {
      globalStorageUri: mocks.uri(path.join(parent, 'storage')),
      globalState: { get: vi.fn(), update },
      workspaceState: { get: vi.fn(() => ({})), update },
    } as unknown as vscode.ExtensionContext;
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it.each(['create', 'interpreter', 'setup'])(
    'lets the %s command cancel before controller changes or Python',
    async (action) => {
      const invalidate = vi.fn();
      const host = { context, bridge, invalidate } as unknown as Controller;
      if (action === 'create') await Controller.prototype.create.call(host);
      else await Controller.prototype.interpreter.call(host, action === 'setup');
      expect(mocks.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('then run'),
        'Manage Workspace Trust',
      );
      expect(invalidate).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(mocks.window.showQuickPick).not.toHaveBeenCalled();
      expect(mocks.executeCommand).not.toHaveBeenCalled();
      expect(await readdir(parent)).toEqual([]);
    },
  );

  it.each(['create', 'interpreter', 'setup'])(
    'guards direct onboarding calls before Python, settings or files',
    async (action) => {
      if (action === 'create') await createProject(context, bridge, 'python3');
      else
        await (action === 'setup' ? setupEnvironment : selectInterpreter)(
          undefined,
          context,
          bridge,
        );
      expect(call).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(mocks.window.showQuickPick).not.toHaveBeenCalled();
      expect(mocks.runPythonCommand).not.toHaveBeenCalled();
      expect(await readdir(parent)).toEqual([]);
    },
  );

  it.each([false, true])(
    'opening trust management never resumes creation even if trust becomes %s',
    async (trusted) => {
      mocks.window.showWarningMessage.mockResolvedValue('Manage Workspace Trust');
      mocks.executeCommand.mockImplementation(async () => {
        mocks.workspace.isTrusted = trusted;
        mocks.workspace.workspaceFolders = [{ uri: mocks.uri('/another-workspace') }];
        return true;
      });
      await Controller.prototype.create.call({ context, bridge } as unknown as Controller);
      expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('workbench.trust.manage');
      expect(call).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(mocks.window.showQuickPick).not.toHaveBeenCalled();
      expect(mocks.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
    },
  );

  it('gives manual navigation guidance if the native trust command fails', async () => {
    mocks.window.showWarningMessage.mockResolvedValue('Manage Workspace Trust');
    mocks.executeCommand.mockRejectedValue(new Error('unavailable'));
    await expect(ensureOnboardingTrust('Create Project')).resolves.toBe(false);
    expect(mocks.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Command Palette'),
    );
    expect(call).not.toHaveBeenCalled();
  });

  function chooseProject(): void {
    mocks.window.showQuickPick
      .mockResolvedValueOnce({ value: 'empty' })
      .mockResolvedValueOnce({ value: false })
      .mockResolvedValueOnce({ value: false });
    mocks.window.showOpenDialog.mockResolvedValue([mocks.uri(path.join(parent, 'project'))]);
  }

  it('runs a fresh explicit trusted retry through the existing bootstrap', async () => {
    await expect(createProject(context, bridge, 'python3')).resolves.toBeUndefined();
    mocks.workspace.isTrusted = true;
    chooseProject();
    await expect(createProject(context, bridge, 'python3')).resolves.toBe(
      path.join(parent, 'project'),
    );
    expect(call.mock.calls.map(([request]) => request.operation)).toEqual(['health', 'init']);
    expect(update).toHaveBeenCalledOnce();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('cancels a trusted wizard without initialization or saved settings', async () => {
    mocks.workspace.isTrusted = true;
    await expect(createProject(context, bridge, 'python3')).resolves.toBeUndefined();
    expect(call.mock.calls.map(([request]) => request.operation)).toEqual(['health']);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['trust', 'workspace'])(
    'rejects changed %s after the project dialogs before bootstrap writes',
    async (change) => {
      mocks.workspace.isTrusted = true;
      chooseProject();
      mocks.window.showOpenDialog.mockImplementation(async () => {
        if (change === 'trust') mocks.workspace.isTrusted = false;
        else mocks.workspace.workspaceFolders = [{ uri: mocks.uri('/changed') }];
        return [mocks.uri(path.join(parent, 'project'))];
      });
      await expect(createProject(context, bridge, 'python3')).resolves.toBeUndefined();
      expect(call.mock.calls.map(([request]) => request.operation)).toEqual(['health']);
      expect(update).not.toHaveBeenCalled();
      expect(mocks.window.showInformationMessage).not.toHaveBeenCalled();
      expect(mocks.window.showErrorMessage).toHaveBeenCalled();
      expect(await readdir(parent)).toEqual([]);
    },
  );

  it('does not report success or return a project for attachment after scope changes while saving settings', async () => {
    mocks.workspace.isTrusted = true;
    chooseProject();
    update.mockImplementation(async () => {
      mocks.workspace.workspaceFolders = [{ uri: mocks.uri('/changed') }];
    });
    await expect(createProject(context, bridge, 'python3')).resolves.toBeUndefined();
    expect(call.mock.calls.map(([request]) => request.operation)).toEqual(['health', 'init']);
    expect(mocks.window.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('workspace or project changed'),
    );
  });

  it('rejects an active project change while choosing its interpreter', async () => {
    mocks.workspace.isTrusted = true;
    let current = true;
    const checkContext = onboardingContext(() => current);
    mocks.window.showQuickPick.mockImplementation(async () => {
      current = false;
      return { path: 'python3' };
    });
    await expect(selectInterpreter(parent, context, bridge, checkContext)).rejects.toThrow(
      'workspace or project changed',
    );
    expect(call).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects changed scope during setup before creating a folder or running Python', async () => {
    mocks.workspace.isTrusted = true;
    let current = true;
    const checkContext = onboardingContext(() => current);
    mocks.window.showQuickPick.mockImplementation(async () => {
      current = false;
      return { installKind: 'git' };
    });
    await expect(setupEnvironment(undefined, context, bridge, checkContext)).rejects.toThrow(
      'workspace or project changed',
    );
    expect(call).not.toHaveBeenCalled();
    expect(mocks.runPythonCommand).not.toHaveBeenCalled();
    expect(await readdir(parent)).toEqual([]);
  });

  it('keeps direct health and persistence boundaries closed in Restricted Mode', async () => {
    await expect(health('python3', bridge)).rejects.toThrow('Workspace trust');
    await expect(persistInterpreter(parent, context, 'python3')).rejects.toThrow('Workspace trust');
    expect(call).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(mocks.workspace.getConfiguration).not.toHaveBeenCalled();
  });

  async function repairFixture(installKind: 'git' | 'local' = 'git'): Promise<{
    projectRoot: string;
    envRoot: string;
    python: string;
  }> {
    const projectRoot = path.join(parent, 'project');
    const envRoot = path.join(projectRoot, '.venv');
    const python = pythonInVenv(envRoot);
    await mkdir(path.dirname(python), { recursive: true });
    await writeFile(python, 'existing interpreter');
    mocks.workspace.isTrusted = true;
    mocks.window.showQuickPick
      .mockResolvedValueOnce({ value: 'repair' })
      .mockResolvedValueOnce({ installKind });
    return { projectRoot, envRoot, python };
  }

  it('force-reinstalls the reviewed source in an explicitly chosen existing environment', async () => {
    const { projectRoot, envRoot, python } = await repairFixture();
    call.mockResolvedValue({
      compatible: true,
      pythonVersion: '3.11.9',
      capabilities: ['sandbox_editor'],
    });
    await expect(setupEnvironment(projectRoot, context, bridge, () => {})).resolves.toBe(python);
    expect(mocks.runPythonCommand).toHaveBeenCalledExactlyOnceWith(
      python,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--force-reinstall',
        REVIEWED_LHP_SOURCE,
      ],
      envRoot,
      expect.any(AbortSignal),
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it('does not report a reviewed install as ready when health lacks sandbox_editor', async () => {
    const { projectRoot } = await repairFixture();
    call.mockResolvedValue({ compatible: true, pythonVersion: '3.11.9', capabilities: [] });
    await expect(setupEnvironment(projectRoot, context, bridge, () => {})).resolves.toBeUndefined();
    expect(mocks.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('sandbox editor APIs'),
      'Retry setup',
      'Choose another folder',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('reinstalls a selected local build while retaining its ordinary compatibility contract', async () => {
    const { projectRoot, envRoot, python } = await repairFixture('local');
    const localSource = path.join(parent, 'local-integration.whl');
    mocks.window.showOpenDialog.mockResolvedValue([mocks.uri(localSource)]);
    call.mockResolvedValue({ compatible: true, pythonVersion: '3.11.9', capabilities: [] });
    await expect(setupEnvironment(projectRoot, context, bridge, () => {})).resolves.toBe(python);
    expect(mocks.runPythonCommand).toHaveBeenCalledExactlyOnceWith(
      python,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--force-reinstall',
        localSource,
      ],
      envRoot,
      expect.any(AbortSignal),
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it('keeps a first-time environment install on the ordinary pip command', async () => {
    mocks.workspace.isTrusted = true;
    mocks.window.showQuickPick
      .mockResolvedValueOnce({ installKind: 'git' })
      .mockResolvedValueOnce({ path: 'python3' });
    call.mockResolvedValue({
      compatible: true,
      pythonVersion: '3.11.9',
      capabilities: ['sandbox_editor'],
    });
    const envRoot = path.join(context.globalStorageUri.fsPath, 'bootstrap-venv');
    await expect(setupEnvironment(undefined, context, bridge, () => {})).resolves.toBe(
      pythonInVenv(envRoot),
    );
    expect(mocks.runPythonCommand).toHaveBeenCalledTimes(2);
    expect(mocks.runPythonCommand).toHaveBeenLastCalledWith(
      pythonInVenv(envRoot),
      ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', REVIEWED_LHP_SOURCE],
      context.globalStorageUri.fsPath,
      expect.any(AbortSignal),
    );
  });
});
