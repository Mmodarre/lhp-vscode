import type { Dispatch, SetStateAction } from 'react';
import type {
  OperationStatus,
  PreviewResult,
  ProjectSnapshot,
  ProjectSummary,
} from '../../../src/shared/protocol';
import type { RequestBody } from '../host';

interface ProjectChromeProps {
  snapshot: ProjectSnapshot;
  projects: ProjectSummary[];
  status: OperationStatus | undefined;
  pending: string | undefined;
  dirtyCount: number;
  canUndo: boolean;
  canGenerate: boolean;
  syntaxError: boolean;
  message: string;
  error: string;
  showInspector: boolean;
  setShowInspector: Dispatch<SetStateAction<boolean>>;
  setPreview: Dispatch<SetStateAction<PreviewResult | undefined>>;
  selectProject: (id: string) => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}

export function ProjectChrome({
  snapshot,
  projects,
  status,
  pending,
  dirtyCount,
  canUndo,
  canGenerate,
  syntaxError,
  message,
  error,
  showInspector,
  setShowInspector,
  setPreview,
  selectProject,
  send,
}: ProjectChromeProps) {
  const running = !!status?.running;
  const projectId = snapshot.context.project.id;
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">LHP</span>
          <span>Lakehouse Plumber</span>
        </div>
        <span className="topbar-meta" title={snapshot.context.project.rootLabel}>
          {snapshot.context.project.name} · {snapshot.context.project.rootLabel}
        </span>
        <span className="topbar-spacer" />
        {snapshot.stale && <span className="badge warn">Stale graph</span>}
        {dirtyCount > 0 && <span className="badge warn">{dirtyCount} unsaved</span>}
        <button
          className="button quiet small"
          onClick={() => setShowInspector(!showInspector)}
          aria-pressed={showInspector}
        >
          Inspector
        </button>
      </header>
      <div className="toolbar" role="toolbar" aria-label="Project commands">
        <div className="toolbar-group">
          <label className="sr-only" htmlFor="project-choice">
            Project
          </label>
          <select
            className="select"
            id="project-choice"
            style={{ width: 145 }}
            value={projectId}
            onChange={(event) => selectProject(event.target.value)}
          >
            {projects.length ? (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))
            ) : (
              <option value={projectId}>{snapshot.context.project.name}</option>
            )}
          </select>
          <label className="sr-only" htmlFor="environment-choice">
            Environment
          </label>
          <select
            className="select"
            id="environment-choice"
            style={{ width: 105 }}
            value={snapshot.context.environment}
            onChange={(event) => {
              setPreview(undefined);
              send({ type: 'selectEnvironment', environment: event.target.value }, true);
            }}
            disabled={running || !!pending}
          >
            {snapshot.context.environments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
          <button
            className="button quiet small"
            onClick={() => send({ type: 'refresh' }, true)}
            disabled={running}
          >
            Refresh
          </button>
        </div>
        <span className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="button secondary small"
            onClick={() => send({ type: 'undo' }, true)}
            disabled={!canUndo}
          >
            Undo
          </button>
          <button
            className="button secondary small"
            onClick={() => send({ type: 'redo' }, true)}
            disabled={!canUndo}
          >
            Redo
          </button>
          <button
            className="button secondary small"
            onClick={() => send({ type: 'validate' }, true)}
            disabled={!snapshot.context.trusted || running || !!pending}
          >
            Validate
          </button>
          <button
            className="button secondary small"
            onClick={() => send({ type: 'preview' }, true)}
            disabled={!snapshot.context.trusted || running || !!pending}
          >
            Preview output
          </button>
          <button
            className="button small"
            onClick={() => send({ type: 'generate' }, true)}
            disabled={!canGenerate}
          >
            Generate full project…
          </button>
          {running && (
            <button className="button danger small" onClick={() => send({ type: 'cancel' })}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {!snapshot.context.runtime.compatible && (
        <div className="notice warn" role="alert">
          <p>
            <strong>LHP runtime unavailable or incompatible.</strong>{' '}
            {snapshot.context.runtime.message ??
              'Choose a compatible LHP editor integration interpreter.'}
          </p>
          <div className="inspector-actions">
            <button
              className="button secondary small"
              onClick={() => send({ type: 'selectInterpreter' })}
            >
              Choose interpreter
            </button>
            <button
              className="button secondary small"
              onClick={() => send({ type: 'setupEnvironment' }, true)}
            >
              Set up environment
            </button>
          </div>
        </div>
      )}
      {!snapshot.context.trusted && (
        <div className="notice warn">
          Workspace trust is required before project edits, validation, or generation.
        </div>
      )}
      {(snapshot.stale || syntaxError) && (
        <div className="notice warn" role="status">
          This graph is based on the last valid project snapshot. Fix YAML errors or refresh before
          making graph edits. Native source files remain editable.
        </div>
      )}
      {snapshot.notices.map((notice, index) => (
        <div className="notice" key={`${index}-${notice}`}>
          {notice}
        </div>
      ))}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
