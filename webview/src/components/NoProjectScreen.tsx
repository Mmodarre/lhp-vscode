import type { OperationStatus, ProjectSummary } from '../../../src/shared/protocol';
import type { RequestBody } from '../host';

interface NoProjectScreenProps {
  logoUri?: string;
  projects: ProjectSummary[];
  trusted: boolean;
  pending: string | undefined;
  status: OperationStatus | undefined;
  error: string;
  selectProject: (id: string) => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}

export function NoProjectScreen({
  logoUri,
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
          {logoUri && <img className="brand-logo" src={logoUri} alt="" width="29" height="29" />}
          Lakehouse Plumber
        </div>
      </header>
      <div className="empty start-screen">
        <p className="eyebrow">Get started</p>
        <h2>{projects.length ? 'Choose an LHP project' : 'Start an LHP project'}</h2>
        <p>
          {projects.length
            ? 'Select a workspace project to inspect its pipelines, resources and declared data.'
            : 'Open a folder containing lhp.yaml, or initialize a project in a trusted workspace. The guide can create a starter or optional TPC-H example.'}
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
            className="button accent"
            onClick={() => send({ type: 'createProject' }, true)}
            disabled={!trusted || !!pending}
          >
            Create project…
          </button>
          <button
            className="button secondary"
            onClick={() => send({ type: 'selectInterpreter' })}
            disabled={!trusted || !!pending}
          >
            Choose Python
          </button>
          <button className="button quiet" onClick={() => send({ type: 'showHelp' })}>
            Get Started guide
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
