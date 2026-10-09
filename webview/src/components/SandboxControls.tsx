import type { SandboxViewState } from '../../../src/shared/protocol';
import type { RequestBody } from '../host';

export function SandboxControls({
  sandbox,
  busy,
  send,
}: {
  sandbox: SandboxViewState | undefined;
  busy: boolean;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}) {
  if (!sandbox) return null;
  const selected = sandbox.selectedPipelines.length;
  const active = sandbox.mode === 'on';
  return (
    <section className="sandbox-strip" aria-label="Sandbox scope">
      <span className={`sandbox-status${active ? ' on' : ''}`}>
        Sandbox {active ? 'On' : 'Off'}
      </span>
      <span className="sandbox-summary">
        {active ? `${selected} of ${sandbox.totalPipelines} pipelines` : 'Full project'}
        {' · '}
        {sandbox.environment}
        {active && sandbox.namespace ? ` · ${sandbox.namespace}` : ''}
      </span>
      {active && sandbox.profileSource === 'draft' && (
        <span className="badge warn">Unsaved profile draft</span>
      )}
      {active && (sandbox.stale || !sandbox.scopeComplete) && (
        <span className="badge warn">Scope incomplete</span>
      )}
      {active && !sandbox.valid && <span className="badge warn">Profile needs attention</span>}
      {active && (!sandbox.valid || !sandbox.scopeComplete) && (
        <span className="sandbox-summary">
          Showing all pipelines for inspection until scope resolves.
        </span>
      )}
      <span className="toolbar-spacer" />
      {active && (
        <label className="sandbox-display">
          Pipeline graphs
          <select
            className="select"
            aria-label="Pipeline display"
            value={sandbox.display}
            onChange={(event) =>
              send(
                { type: 'setPipelineDisplay', display: event.target.value as 'selected' | 'all' },
                true,
              )
            }
            disabled={busy}
          >
            <option value="selected">Selected pipelines</option>
            <option value="all">Show all</option>
          </select>
        </label>
      )}
      <button
        className="button quiet small"
        onClick={() => send({ type: 'showSandboxScope' })}
        disabled={busy}
      >
        Review scope
      </button>
      <button
        className="button quiet small"
        onClick={() => send({ type: 'configureSandboxProfile' })}
        disabled={busy}
      >
        Configure profile
      </button>
      <button
        className="button secondary small"
        aria-label={active ? 'Turn Sandbox off' : 'Turn Sandbox on'}
        onClick={() => send({ type: 'setSandboxMode', mode: active ? 'off' : 'on' }, true)}
        disabled={busy}
      >
        Turn {active ? 'off' : 'on'}
      </button>
      <p className="sandbox-impact">
        {active
          ? `Generation replaces generated/${sandbox.environment} for the selected profile pipelines and synchronizes managed resources/lhp.`
          : `Generation replaces generated/${sandbox.environment} for the full project and synchronizes managed resources/lhp.`}
      </p>
      {active && sandbox.error && (
        <p className="sandbox-error" role="status">
          {sandbox.error}
        </p>
      )}
    </section>
  );
}
