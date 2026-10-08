import type { OperationStatus, ProjectSummary } from '../../../src/shared/protocol';
import type { RequestBody } from '../host';

interface NoProjectScreenProps {
  projects: ProjectSummary[];
  trusted: boolean;
  pending: string | undefined;
  status: OperationStatus | undefined;
  error: string;
  selectProject: (id: string) => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}

export function NoProjectScreen({
  projects,
  trusted,
  pending,
  status,
  error,
  selectProject,
  send,
}: NoProjectScreenProps) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">LHP</span> Lakehouse Plumber
        </div>
      </header>
      <div className="empty">
        <h2>{projects.length ? 'Choose an LHP project' : 'Start an LHP project'}</h2>
        <p>
          {projects.length
            ? 'Select a workspace project to inspect its pipelines and flowgroups.'
            : 'No project was found in this workspace. Initialize one in a trusted folder to begin.'}
        </p>
        {!trusted && (
          <div className="notice warn">Trust this workspace before project setup or editing.</div>
        )}
        {projects.map((project) => (
          <button
            key={project.id}
            className="button secondary"
            onClick={() => selectProject(project.id)}
          >
            {project.name} · {project.rootLabel}
          </button>
        ))}
        <div className="inspector-actions">
          <button
            className="button"
            onClick={() => send({ type: 'createProject' }, true)}
            disabled={!trusted || !!pending}
          >
            Initialize project
          </button>
          <button className="button secondary" onClick={() => send({ type: 'selectInterpreter' })}>
            Select Python interpreter
          </button>
        </div>
        {status?.message && <p role="status">{status.message}</p>}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
