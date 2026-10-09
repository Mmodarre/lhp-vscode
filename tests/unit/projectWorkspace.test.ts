import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Controller } from '../../src/controller';
import type { ProjectResourceIndex } from '../../src/shared/protocol';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  overlays: vi.fn(() => [] as { path: string; text: string }[]),
}));
vi.mock('../../src/documents', () => ({ projectOverlays: mocks.overlays }));
vi.mock('../../src/resourceIndex', async (original) => ({
  ...(await original<typeof import('../../src/resourceIndex')>()),
  scanResources: mocks.scan,
}));
import { ProjectWorkspace } from '../../src/projectWorkspace';
import { classifyResource } from '../../src/resourceClassification';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('replays newer native draft classification after an older full resource scan completes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lhp-index-race-'));
  roots.push(root);
  await mkdir(path.join(root, 'substitutions'));
  await writeFile(path.join(root, 'substitutions/dev.yaml'), 'global:\n  saved: value\n');
  const index: ProjectResourceIndex = {
    projectId: 'p',
    revision: 1,
    files: [classifyResource('substitutions/dev.yaml')],
    environments: ['dev'],
    tokens: [],
    complete: true,
    loading: false,
    warnings: [],
  };
  const project = { root, summary: { id: 'p', name: 'p', rootLabel: 'p' } };
  const host = {
    project,
    projects: [project],
    epoch: 1,
    ownsUri: () => true,
    activePipelineConfig: () => '',
    notifyState: vi.fn(),
    report: vi.fn(),
    context: { workspaceState: { get: () => ({}) } },
  } as unknown as Controller;
  const workspace = new ProjectWorkspace(host);
  mocks.scan.mockResolvedValueOnce(index);
  mocks.overlays.mockReturnValue([]);
  await workspace.refresh();
  let resolve!: (index: ProjectResourceIndex) => void;
  mocks.scan.mockImplementationOnce(
    () =>
      new Promise<ProjectResourceIndex>((done) => {
        resolve = done;
      }),
  );
  const pending = workspace.refresh();
  mocks.overlays.mockReturnValue([
    { path: 'substitutions/dev.yaml', text: 'global:\n  newest: draft\n' },
  ]);
  workspace.sourceChanged({
    scheme: 'file',
    fsPath: path.join(root, 'substitutions/dev.yaml'),
  } as vscode.Uri);
  await expect.poll(() => workspace.index?.tokens.map((token) => token.name)).toEqual(['newest']);
  // A full scan started before this edit and returns its old classification.
  resolve(index);
  await pending;
  expect(workspace.index?.tokens.map((token) => token.name)).toEqual(['newest']);
  expect(workspace.index?.loading).toBe(false);
  workspace.dispose();
});
