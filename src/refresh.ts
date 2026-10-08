import type { Controller } from './controller';
import { snapshotDocuments } from './documents';
import { inspectRuntime } from './projects';
import { normalizeSnapshot } from './snapshot';
import { failedSnapshot, pendingSnapshot } from './snapshotState';

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
    const previous = host.snapshot;
    const pending = pendingSnapshot(previous, context, epoch);
    await host.publishSnapshot(pending, project, epoch);
    if (!runtime.compatible) return;
    try {
      const data = await host.call('snapshot', project, runtime, signal);
      if (epoch !== host.epoch || signal.aborted || host.project !== project) return;
      let snapshot = normalizeSnapshot(project.root, data, context, epoch);
      snapshot.documents = (await snapshotDocuments(project.root, snapshot, signal)).map(
        ({ path, version, dirty }) => ({ path, version, dirty }),
      );
      snapshot.refreshState = 'ready';
      if (snapshot.stale && pending.flowgroups.length)
        snapshot = {
          ...pending,
          context: snapshot.context,
          diagnostics: snapshot.diagnostics,
          documents: snapshot.documents,
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
