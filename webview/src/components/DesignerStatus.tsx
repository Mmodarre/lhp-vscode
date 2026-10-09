import type { OperationStatus, ProjectSnapshot } from '../../../src/shared/protocol';

export function DesignerStatus({
  snapshot,
  status,
}: {
  snapshot: ProjectSnapshot;
  status?: OperationStatus;
}) {
  const validationAvailable =
    snapshot.context.runtime.compatible && (snapshot.refreshState ?? 'ready') === 'ready';
  return (
    <footer className="statusbar" role="status">
      <span>{snapshot.context.environment} environment</span>
      <span>·</span>
      <span>{snapshot.context.runtime.lhpVersion ?? 'LHP runtime unavailable'}</span>
      <span>·</span>
      <span>
        {validationAvailable
          ? `${snapshot.diagnostics.filter((item) => item.severity === 'error').length} errors, ${snapshot.diagnostics.filter((item) => item.severity === 'warning').length} warnings`
          : 'Validation unavailable'}
      </span>
      <span className="spacer" />
      {status?.message && <span>{status.message}</span>}
      <span>Revision {snapshot.revision}</span>
    </footer>
  );
}
