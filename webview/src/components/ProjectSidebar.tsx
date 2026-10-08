import { useState } from 'react';
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
  onCreateMode: (mode: 'bronze' | 'new-flowgroup' | 'template' | 'blueprint') => void;
  send: (body: RequestBody, expectUpdate?: boolean) => string;
  onClose: () => void;
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
  onClose,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('');
  const selectedPipeline = snapshot.pipelines.find((item) => item.name === pipelineName);
  const matched =
    selectedPipeline?.flowgroups.filter((group) =>
      group.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  return (
    <nav
      className="sidebar designer-browse"
      id="designer-browse"
      aria-label="Browse project graphs"
    >
      <div className="browse-header">
        <h2 className="section-heading">Browse graphs</h2>
        <button className="button quiet small" onClick={onClose} aria-label="Close browse panel">
          Close
        </button>
      </div>
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
          </li>
        ))}
      </ul>
      {selectedPipeline && (
        <>
          <h2 className="section-heading">{selectedPipeline.name} flowgroups</h2>
          <label className="sr-only" htmlFor="browse-flowgroups">
            Find flowgroup
          </label>
          <input
            id="browse-flowgroups"
            className="input browse-search"
            placeholder="Find flowgroup"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="tree">
            {matched.slice(0, 100).map((group) => (
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
                  <span className="label" title={group.name}>
                    {group.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {matched.length > 100 && (
            <p className="section-note">
              Showing 100 of {matched.length} flowgroups. Type to narrow results; the native LHP
              sidebar contains the full tree.
            </p>
          )}
        </>
      )}
      {snapshot.pipelines.length === 0 && (
        <p className="section-note">
          {!snapshot.context.runtime.compatible
            ? 'Pipeline list unavailable until the selected Python can load LHP.'
            : snapshot.refreshState === 'failed'
              ? 'Pipeline list could not load. Choose Refresh to retry.'
              : snapshot.refreshState === 'loading'
                ? 'Refreshing pipeline list…'
                : 'No pipelines yet. Start with the files-to-bronze guide.'}
        </p>
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
        <button
          className="button quiet small"
          onClick={() => onCreateMode('new-flowgroup')}
          disabled={!canEdit}
        >
          Flowgroup / pipeline
        </button>
        <button
          className="button quiet small"
          onClick={() => onCreateMode('template')}
          disabled={!canEdit}
        >
          Template instance
        </button>
        <button
          className="button quiet small"
          onClick={() => onCreateMode('blueprint')}
          disabled={!canEdit}
        >
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
