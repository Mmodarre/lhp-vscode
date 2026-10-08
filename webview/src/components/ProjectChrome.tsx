import type { Dispatch, SetStateAction } from 'react';
import type {
  OperationStatus,
  PreviewResult,
  ProjectSnapshot,
  ProjectSummary,
} from '../../../src/shared/protocol';
import type { RequestBody } from '../host';
import { ProjectNotices } from './ProjectNotices';

interface ProjectChromeProps {
  logoUri?: string;
  mode: string;
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
  canEdit: boolean;
  setShowInspector: Dispatch<SetStateAction<boolean>>;
  setPreview: Dispatch<SetStateAction<PreviewResult | undefined>>;
  selectProject: (id: string) => void;
  onProjectMap: () => void;
  onData: () => void;
  onCreate: (mode: 'bronze' | 'template' | 'blueprint' | 'new-flowgroup') => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}

export function ProjectChrome({
  logoUri,
  mode,
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
  canEdit,
  setShowInspector,
  setPreview,
  selectProject,
  onProjectMap,
  onData,
  onCreate,
  send,
}: ProjectChromeProps) {
  const running = !!status?.running;
  const projectId = snapshot.context.project.id;
  const refreshState = snapshot.refreshState ?? 'ready';
  const runtime = snapshot.context.runtime;
  const showRuntimeHelp = !runtime.compatible && refreshState === 'ready';
  return (
    <>
      <header className="topbar">
        <div className="brand">
          {logoUri && <img className="brand-logo" src={logoUri} alt="" width="29" height="29" />}
          <span>Lakehouse Plumber</span>
        </div>
        <span
          className="topbar-meta"
          title={`${snapshot.context.project.name} · ${snapshot.context.project.rootLabel}`}
        >
          <span aria-hidden="true">/</span> {snapshot.context.project.name}
        </span>
        <span className="topbar-spacer" />
        {refreshState === 'loading' ? (
          <span className="badge">Refreshing graph</span>
        ) : refreshState === 'failed' ? (
          <span className="badge warn">Graph refresh failed</span>
        ) : snapshot.stale && runtime.compatible ? (
          <span className="badge warn">Stale graph</span>
        ) : null}
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
            disabled={!snapshot.context.trusted || running || !!pending}
          >
            {snapshot.context.environments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
          <button
            className="button quiet small"
            onClick={onProjectMap}
            aria-pressed={mode === 'project'}
          >
            Project map
          </button>
          <button className="button quiet small" onClick={onData} aria-pressed={mode === 'data'}>
            Data lineage
          </button>
          <label className="sr-only" htmlFor="create-choice">
            Create
          </label>
          <select
            id="create-choice"
            className="select create-choice"
            value=""
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'bronze' ||
                value === 'new-flowgroup' ||
                value === 'template' ||
                value === 'blueprint'
              )
                onCreate(value);
            }}
            disabled={!canEdit}
          >
            <option value="">+ Create…</option>
            <option value="bronze">Files to bronze</option>
            <option value="new-flowgroup">Flowgroup / pipeline</option>
            <option value="template">Template instance</option>
            <option value="blueprint">Blueprint instance</option>
          </select>
        </div>
        <span className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="button quiet small"
            onClick={() => send({ type: 'refresh' }, true)}
            disabled={running}
          >
            Refresh
          </button>
          <button
            className="button accent-secondary small"
            onClick={() => send({ type: 'undo' }, true)}
            disabled={!canUndo}
          >
            Undo
          </button>
          <button
            className="button accent-secondary small"
            onClick={() => send({ type: 'redo' }, true)}
            disabled={!canUndo}
          >
            Redo
          </button>
          <button
            className="button accent small"
            onClick={() => send({ type: 'validate' }, true)}
            disabled={
              !snapshot.context.trusted ||
              !runtime.compatible ||
              refreshState !== 'ready' ||
              running ||
              !!pending
            }
          >
            Validate
          </button>
          <button
            className="button accent-secondary small"
            onClick={() => send({ type: 'preview' }, true)}
            disabled={
              !snapshot.context.trusted ||
              !runtime.compatible ||
              refreshState !== 'ready' ||
              running ||
              !!pending
            }
          >
            Preview output
          </button>
          <button
            className="button accent-secondary small"
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
          <details className="toolbar-menu">
            <summary className="button quiet small" aria-label="More project commands">
              More ▾
            </summary>
            <div className="toolbar-menu-items">
              <button
                onClick={() => send({ type: 'selectInterpreter' })}
                disabled={!snapshot.context.trusted || running || !!pending}
              >
                Choose Python interpreter
              </button>
              <button
                onClick={() => send({ type: 'databricks' })}
                disabled={!snapshot.context.trusted || running || !!pending}
              >
                Databricks handoff
              </button>
              <button onClick={() => send({ type: 'showHelp' })}>Get Started and help</button>
            </div>
          </details>
        </div>
      </div>
      {showRuntimeHelp && (
        <div className="notice warn" role="alert">
          <p>
            <strong>The selected Python cannot load the LHP editor integration.</strong>{' '}
            {runtime.message ??
              'Choose a compatible interpreter or set up the reviewed integration.'}
          </p>
          <p>
            Selected Python: <code className="mono interpreter-path">{runtime.interpreter}</code>
          </p>
          <div className="inspector-actions">
            <button
              className="button secondary small"
              onClick={() => send({ type: 'selectInterpreter' })}
              disabled={!snapshot.context.trusted || running || !!pending}
            >
              Choose interpreter
            </button>
            <button
              className="button secondary small"
              onClick={() => send({ type: 'setupEnvironment' }, true)}
              disabled={!snapshot.context.trusted || running || !!pending}
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
      {refreshState === 'loading' && (
        <div className="notice" role="status">
          Refreshing this project's graph. The displayed structure may be out of date until loading
          finishes.
        </div>
      )}
      {refreshState === 'failed' && (
        <div className="notice error" role="alert">
          <p>
            <strong>The project graph could not refresh.</strong>{' '}
            {snapshot.refreshError ?? 'Check the extension error and choose Refresh to retry.'}
          </p>
          <p>
            {snapshot.pipelines.length
              ? 'The displayed graph is the last successful view.'
              : 'No project graph is available yet.'}{' '}
            Selected Python: <code className="mono interpreter-path">{runtime.interpreter}</code>
          </p>
        </div>
      )}
      {refreshState === 'ready' && runtime.compatible && (snapshot.stale || syntaxError) && (
        <div className="notice warn" role="status">
          {syntaxError
            ? 'The YAML source has syntax errors. This graph shows the last valid project snapshot. Fix the YAML in a native editor or use Undo, then refresh.'
            : 'Project source changed. This graph shows the last valid project snapshot. Refresh before making graph edits.'}
        </div>
      )}
      {refreshState === 'ready' && runtime.compatible && (
        <ProjectNotices key={snapshot.context.project.id} notices={snapshot.notices} />
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {error && error !== snapshot.refreshError && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
