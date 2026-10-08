import type { ProjectSnapshot } from '../../../src/shared/protocol';
import type { RequestBody } from '../host';

interface ProjectSidebarProps {
  snapshot: ProjectSnapshot;
  mode: string;
  pipelineName: string | undefined;
  flowgroupId: string | undefined;
  canEdit: boolean;
  choosePipeline: (name: string) => void;
  chooseFlowgroup: (id: string) => void;
  onCreateMode: (mode: 'bronze' | 'template' | 'blueprint') => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
}

export function ProjectSidebar({
  snapshot,
  mode,
  pipelineName,
  flowgroupId,
  canEdit,
  choosePipeline,
  chooseFlowgroup,
  onCreateMode,
  send,
}: ProjectSidebarProps) {
  return (
    <nav className="sidebar" aria-label="Project structure">
      <h2 className="section-heading">Pipelines</h2>
      <ul className="tree">
        {snapshot.pipelines.map((item) => (
          <li key={item.name}>
            <button
              className="tree-button"
              aria-current={mode === 'pipeline' && item.name === pipelineName ? 'page' : undefined}
              onClick={() => choosePipeline(item.name)}
            >
              <span className="tree-icon" aria-hidden="true">
                ▤
              </span>
              <span className="label">{item.name}</span>
              <span className="tree-count">{item.flowgroups.length}</span>
            </button>
            <ul className="tree-nested">
              {item.flowgroups.map((group) => (
                <li key={group.id}>
                  <button
                    className="tree-button"
                    aria-current={
                      mode === 'flowgroup' && group.id === flowgroupId ? 'page' : undefined
                    }
                    onClick={() => chooseFlowgroup(group.id)}
                  >
                    <span className="tree-icon" aria-hidden="true">
                      ◇
                    </span>
                    <span className="label">{group.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {snapshot.pipelines.length === 0 && (
        <p className="section-note">No pipelines yet. Start with the files-to-bronze guide.</p>
      )}
      <h2 className="section-heading">Create</h2>
      <div style={{ padding: '0 10px 12px', display: 'grid', gap: 5 }}>
        <button
          className="button secondary small"
          onClick={() => onCreateMode('bronze')}
          disabled={!canEdit}
        >
          Files → bronze
        </button>
        <button className="button quiet small" onClick={() => onCreateMode('template')}>
          Template instance
        </button>
        <button className="button quiet small" onClick={() => onCreateMode('blueprint')}>
          Blueprint instance
        </button>
      </div>
      <h2 className="section-heading">Help</h2>
      <div style={{ padding: '0 10px 12px', display: 'grid', gap: 5 }}>
        <button className="button quiet small" onClick={() => send({ type: 'databricks' })}>
          Databricks handoff
        </button>
        <button className="button quiet small" onClick={() => send({ type: 'selectInterpreter' })}>
          Python interpreter
        </button>
      </div>
    </nav>
  );
}
