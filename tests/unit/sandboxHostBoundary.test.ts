import { describe, expect, it, vi } from 'vitest';
import type { Controller } from '../../src/controller';
import { demoSnapshot } from '../../webview/src/demoFixture';

const mocks = vi.hoisted(() => ({
  documents: [] as {
    uri: { scheme: string; fsPath: string; path: string };
    isDirty: boolean;
    version: number;
    getText: () => string;
  }[],
  warning: vi.fn(),
  information: vi.fn(),
  guide: vi.fn(async () => {}),
}));
vi.mock('vscode', () => ({
  workspace: {
    get textDocuments() {
      return mocks.documents;
    },
    isTrusted: true,
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
  window: { showWarningMessage: mocks.warning, showInformationMessage: mocks.information },
  Uri: { file: (filename: string) => ({ fsPath: filename, path: filename, scheme: 'file' }) },
}));
vi.mock('../../src/sandboxProfile', () => ({ configureSandboxProfile: mocks.guide }));
import { Controller as ControllerClass } from '../../src/controller';
import { dispatch } from '../../src/dispatch';
import { projectOverlays } from '../../src/documents';
import { generateSavedProject, operate } from '../../src/projectOperations';
import { callBridge } from '../../src/projectCalls';
import { currentSandboxView, setSandboxMode } from '../../src/sandboxHost';

describe('sandbox host boundaries', () => {
  it('opens the guide only after a fresh canonical snapshot confirms no profile', async () => {
    const snapshot = demoSnapshot();
    snapshot.context.runtime.capabilities = ['sandbox_editor'];
    const project = { summary: snapshot.context.project };
    let mode: 'off' | 'on' = 'off';
    const host = {
      project,
      snapshot,
      runtime: snapshot.context.runtime,
      get sandboxMode() {
        return mode;
      },
      context: {
        workspaceState: {
          get: () => ({ [project.summary.id]: mode }),
          update: async (_key: string, value: Record<string, 'off' | 'on'>) => {
            mode = value[project.summary.id]!;
          },
        },
      },
      requireProject: () => project,
      invalidateContext: vi.fn(),
      refresh: vi.fn(async () => {}),
    } as unknown as Controller;
    mocks.guide.mockClear();
    for (const [refreshState, stale] of [
      ['loading', false],
      ['failed', true],
      ['ready', true],
    ] as const) {
      mode = 'off';
      snapshot.refreshState = refreshState;
      snapshot.stale = stale;
      await setSandboxMode(host, 'on');
      expect(mocks.guide).not.toHaveBeenCalled();
    }
    mode = 'off';
    snapshot.refreshState = 'ready';
    snapshot.stale = false;
    snapshot.sandbox = {
      mode: 'on',
      display: 'selected',
      profilePath: '.lhp/profile.yaml',
      profileExists: false,
      profileSource: 'missing',
      patterns: [],
      selectedPipelines: [],
      totalPipelines: 1,
      allowedEnvironments: [],
      environment: 'dev',
      valid: false,
      stale: false,
      scopeComplete: false,
      previewParity: 'source-only',
    };
    await setSandboxMode(host, 'on');
    expect(mocks.guide).toHaveBeenCalledOnce();
  });

  it('never presents a last-good scope as complete while its graph refresh is stale', () => {
    const snapshot = demoSnapshot();
    snapshot.stale = true;
    snapshot.refreshState = 'ready';
    snapshot.sandbox = {
      mode: 'on',
      display: 'selected',
      profilePath: '.lhp/profile.yaml',
      profileExists: true,
      profileSource: 'saved',
      namespace: 'alice',
      patterns: ['bronze'],
      selectedPipelines: ['bronze'],
      totalPipelines: 1,
      allowedEnvironments: [],
      environment: 'dev',
      valid: true,
      stale: false,
      scopeComplete: true,
      previewParity: 'source-only',
    };
    const host = {
      snapshot,
      project: { summary: snapshot.context.project },
      sandboxMode: 'on',
      pipelineDisplay: 'selected',
      environment: () => 'dev',
      context: { workspaceState: { get: () => ({}) } },
    } as unknown as Controller;
    expect(currentSandboxView(host)).toMatchObject({ stale: true, scopeComplete: false });
  });

  it('requires current project and revision before mode changes and usage navigation', async () => {
    const snapshot = demoSnapshot();
    const host = {
      snapshot,
      project: { summary: snapshot.context.project },
      epoch: snapshot.revision,
      setSandboxMode: vi.fn(),
      showUsages: vi.fn(),
      panel: { post: vi.fn() },
    } as unknown as Controller;
    host.assertContext = ControllerClass.prototype.assertContext.bind(host);
    await expect(
      dispatch(host, { type: 'setSandboxMode', requestId: '1', mode: 'on' }),
    ).rejects.toThrow(/stale/);
    await expect(
      dispatch(host, {
        type: 'setSandboxMode',
        requestId: '1',
        mode: 'on',
        context: { projectId: 'other', revision: snapshot.revision },
      }),
    ).rejects.toThrow(/stale/);
    await expect(
      dispatch(host, {
        type: 'showUsages',
        requestId: '2',
        path: 'sql/shared.sql',
        context: { projectId: snapshot.context.project.id, revision: snapshot.revision - 1 },
      }),
    ).rejects.toThrow(/stale/);
    expect(host.setSandboxMode).not.toHaveBeenCalled();
    expect(host.showUsages).not.toHaveBeenCalled();
  });

  it('includes only the exact dirty canonical profile in native bridge overlays', () => {
    const root = '/project';
    mocks.documents = [
      {
        uri: {
          scheme: 'file',
          fsPath: '/project/.lhp/profile.yaml',
          path: '/project/.lhp/profile.yaml',
        },
        isDirty: true,
        version: 4,
        getText: () => 'sandbox:\n  namespace: alice\n',
      },
      {
        uri: {
          scheme: 'file',
          fsPath: '/project/.lhp/private.yaml',
          path: '/project/.lhp/private.yaml',
        },
        isDirty: true,
        version: 3,
        getText: () => 'secret: value',
      },
    ];
    expect(projectOverlays(root)).toEqual([
      { path: '.lhp/profile.yaml', version: 4, text: 'sandbox:\n  namespace: alice\n' },
    ]);
    mocks.documents = [];
  });

  it('blocks unresolved On mode before Python and rejects scope changes during generation confirmation', async () => {
    const snapshot = demoSnapshot();
    snapshot.context.runtime.capabilities = ['sandbox_editor'];
    const project = { root: '/project', summary: snapshot.context.project };
    const run = vi.fn();
    const host = {
      project,
      snapshot,
      epoch: snapshot.revision,
      sandboxMode: 'on',
      sandboxIdentity: 'scope-a',
      sandboxView: {
        mode: 'on',
        valid: false,
        scopeComplete: false,
        stale: false,
        error: 'Profile missing',
        profileSource: 'missing',
        selectedPipelines: [],
        namespace: undefined,
      },
      runtime: snapshot.context.runtime,
      requireProject: () => project,
      environment: () => 'dev',
      activePipelineConfig: () => '',
      run,
    } as unknown as Controller;
    await expect(operate(host, 'preview')).rejects.toThrow('Profile missing');
    expect(run).not.toHaveBeenCalled();
    host.sandboxView!.valid = true;
    host.sandboxView!.scopeComplete = true;
    host.sandboxView!.profileSource = 'saved';
    host.sandboxView!.selectedPipelines = ['bronze'];
    mocks.warning.mockImplementationOnce(async () => {
      Object.defineProperty(host, 'sandboxIdentity', { value: 'scope-b', configurable: true });
      return 'Save and generate sandbox scope';
    });
    await expect(operate(host, 'generate')).rejects.toThrow(/scope changed/);
    expect(run).not.toHaveBeenCalled();
  });

  it('forwards the sandbox flag and exact native profile draft to preview but never to generation', async () => {
    const snapshot = demoSnapshot();
    const project = { root: '/project', summary: snapshot.context.project };
    mocks.documents = [
      {
        uri: {
          scheme: 'file',
          fsPath: '/project/.lhp/profile.yaml',
          path: '/project/.lhp/profile.yaml',
        },
        isDirty: true,
        version: 5,
        getText: () => 'sandbox:\n  namespace: alice\n',
      },
    ];
    const bridge = { call: vi.fn(async () => ({})) };
    const host = {
      bridge,
      projects: [project],
      sandboxMode: 'on',
      environment: () => 'dev',
      activePipelineConfig: () => '',
      publishStatus: vi.fn(),
    } as unknown as Controller;
    await callBridge(
      host,
      'preview',
      project,
      snapshot.context.runtime,
      new AbortController().signal,
    );
    expect(bridge.call).toHaveBeenLastCalledWith(
      expect.objectContaining({
        documents: [
          { path: '.lhp/profile.yaml', version: 5, text: 'sandbox:\n  namespace: alice\n' },
        ],
        options: expect.objectContaining({ sandboxEnabled: true }),
      }),
    );
    await callBridge(
      host,
      'generate',
      project,
      snapshot.context.runtime,
      new AbortController().signal,
    );
    expect(bridge.call).toHaveBeenLastCalledWith(
      expect.objectContaining({
        documents: undefined,
        options: expect.objectContaining({ sandboxEnabled: true }),
      }),
    );
    mocks.documents = [];
  });

  it('saves the native profile before scoped generation and records only a matching returned scope', async () => {
    const snapshot = demoSnapshot();
    snapshot.context.runtime.capabilities = ['sandbox_editor'];
    snapshot.refreshState = 'ready';
    const project = { root: '/project', summary: snapshot.context.project };
    const profile = {
      uri: {
        scheme: 'file',
        fsPath: '/project/.lhp/profile.yaml',
        path: '/project/.lhp/profile.yaml',
      },
      isDirty: true,
      version: 5,
      getText: () => 'sandbox: {}',
      save: vi.fn(async () => {
        profile.isDirty = false;
        return true;
      }),
    };
    mocks.documents = [profile];
    const view = {
      mode: 'on' as const,
      valid: true,
      scopeComplete: true,
      stale: false,
      profileSource: 'draft' as 'draft' | 'saved',
      selectedPipelines: ['bronze'],
      namespace: 'alice',
    };
    const recordGeneration = vi.fn(async () => undefined);
    const recordOutputScope = vi.fn(async () => undefined);
    const bridgeCall = vi.fn(async () => ({
      success: true,
      sandbox_enabled: true,
      sandbox: { namespace: 'alice', resolved_pipelines: ['bronze'] },
      environment: 'dev',
    }));
    const host = {
      project,
      projects: [project],
      snapshot,
      epoch: snapshot.revision,
      sandboxMode: 'on',
      sandboxIdentity: 'scope-a',
      sandboxView: view,
      runtime: snapshot.context.runtime,
      workspace: { recordGeneration },
      recordOutputScope,
      requireProject: () => project,
      ownsUri: () => true,
      environment: () => 'dev',
      activePipelineConfig: () => '',
      refresh: vi.fn(async () => {
        view.profileSource = 'saved';
      }),
      refreshResources: vi.fn(async () => undefined),
      call: bridgeCall,
      run: vi.fn(async (_operation, task: (signal: AbortSignal) => Promise<void>) =>
        task(new AbortController().signal),
      ),
      panel: { post: vi.fn() },
      isOperating: false,
    } as unknown as Controller;
    await expect(generateSavedProject(host)).rejects.toThrow(/Save .lhp\/profile.yaml/);
    mocks.warning.mockResolvedValueOnce('Save and generate sandbox scope');
    await operate(host, 'generate');
    expect(profile.save).toHaveBeenCalledOnce();
    expect(bridgeCall).toHaveBeenCalledWith(
      'generate',
      project,
      snapshot.context.runtime,
      expect.any(AbortSignal),
    );
    expect(recordGeneration).toHaveBeenCalledOnce();
    expect(recordOutputScope).toHaveBeenCalledWith('scope-a');
    mocks.documents = [];
  });
});
