import type { Controller } from './controller';
import { snapshotDocuments } from './documents';
import { inspectRuntime } from './projects';
import { normalizeSnapshot } from './snapshot';
import { failedSnapshot, pendingSnapshot } from './snapshotState';
import { sandboxView } from './sandboxState';
import { SANDBOX_PROFILE_PATH } from './paths';
import * as vscode from 'vscode';

/** Publish current runtime health before potentially expensive project work. */
export async function refreshProject(host: Controller): Promise<void> {
  const project = host.project!;
  const epoch = host.epoch;
  const publishFailure = async (error: unknown, signal: AbortSignal): Promise<void> => {
    if (epoch !== host.epoch || host.project !== project || !host.snapshot) return;
    await host.publishSnapshot(
      failedSnapshot(
        host.snapshot,
        signal.aborted
          ? new Error('Refresh cancelled. Refresh again to load the current graph.')
          : error,
      ),
      project,
      epoch,
    );
  };
  await host.run('snapshot', async (signal) => {
    const runtime = await inspectRuntime(project, host.context, host.bridge, signal).catch(
      async (error) => {
        await publishFailure(error, signal);
        throw error;
      },
    );
    if (epoch !== host.epoch || signal.aborted || host.project !== project) return;
    const context = {
      project: project.summary,
      environment: host.environment(project),
      environments: host.snapshot?.context.environments ?? [host.environment(project)],
      runtime,
      trusted: true,
    };
    const previous = host.snapshot?.sandbox?.mode === host.sandboxMode ? host.snapshot : undefined;
    const pending = pendingSnapshot(previous, context, epoch);
    await host.publishSnapshot(pending, project, epoch);
    await host.workspace.bootstrapCatalog(project, runtime, signal).catch((error) => {
      if (signal.aborted) throw error;
      // Malformed catalogue files must not prevent physical source repair or
      // canonical snapshot diagnostics from being loaded.
      if (host.workspace.index)
        host.workspace.index = {
          ...host.workspace.index,
          warnings: [
            ...host.workspace.index.warnings,
            `Catalogue unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
          ],
        };
      host.notifyState();
    });
    if (!runtime.compatible) return;
    try {
      const data = await host.call('snapshot', project, runtime, signal);
      if (epoch !== host.epoch || signal.aborted || host.project !== project) return;
      let snapshot = normalizeSnapshot(project.root, data, context, epoch);
      snapshot.sandbox = sandboxView(
        data,
        snapshot,
        host.sandboxMode,
        host.pipelineDisplay,
        vscode.workspace.textDocuments.some(
          (document) =>
            document.isDirty &&
            document.uri.scheme === 'file' &&
            document.uri.fsPath ===
              vscode.Uri.file(project.root + '/' + SANDBOX_PROFILE_PATH).fsPath,
        ),
      );
      snapshot.documents = (
        await snapshotDocuments(
          project.root,
          snapshot,
          signal,
          host.projects
            .filter((candidate) => candidate !== project)
            .map((candidate) => candidate.root),
        )
      ).map(({ path, version, dirty }) => ({ path, version, dirty }));
      snapshot.refreshState = 'ready';
      if (snapshot.stale && pending.flowgroups.length)
        snapshot = {
          ...pending,
          context: snapshot.context,
          diagnostics: snapshot.diagnostics,
          documents: snapshot.documents,
          sandbox: snapshot.sandbox
            ? { ...snapshot.sandbox, stale: true, scopeComplete: false }
            : undefined,
          stale: true,
          refreshState: 'ready',
          notices: ['Showing the last valid graph while source errors are corrected.'],
        };
      if (epoch !== host.epoch || signal.aborted || host.project !== project) return;
      await host.publishSnapshot(snapshot, project, epoch);
    } catch (error) {
      await publishFailure(error, signal);
      throw error;
    }
  });
}
