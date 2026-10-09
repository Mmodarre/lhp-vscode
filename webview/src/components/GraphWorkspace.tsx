import type {
  FlowgroupDetail,
  FlowgroupSummary,
  OperationStatus,
  PipelineSummary,
  ProjectDatasetIndex,
  ProjectSnapshot,
  SandboxViewState,
  SourceRef,
} from '../../../src/shared/protocol';
import type { GraphModel } from '../model';
import { GraphPanel } from './GraphPanel';

export type GraphMode = 'project' | 'pipeline' | 'flowgroup' | 'data';

interface GraphWorkspaceProps {
  snapshot: ProjectSnapshot;
  visiblePipelines: PipelineSummary[];
  sandbox?: SandboxViewState;
  mode: GraphMode;
  pipeline?: PipelineSummary;
  flowgroup?: FlowgroupDetail;
  currentDatasets?: ProjectDatasetIndex;
  graph?: GraphModel;
  selectedSummary?: FlowgroupSummary;
  missingSelection?: 'pipeline' | 'flowgroup';
  actionId: string;
  datasetId: string;
  canEdit: boolean;
  browseOpen: boolean;
  pending?: string;
  status?: OperationStatus;
  refreshState: 'loading' | 'ready' | 'failed';
  onToggleBrowse: () => void;
  onChoosePipeline: (name: string) => void;
  onChooseFlowgroup: (id: string) => void;
  onChooseAction: (id: string) => void;
  onSelectDataset: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onAddAction: () => void;
  onOpen: (source: SourceRef) => void;
  onCreateFlowgroup: () => void;
  onLoadData: () => void;
}

export function GraphWorkspace({
  snapshot,
  visiblePipelines,
  sandbox,
  mode,
  pipeline,
  flowgroup,
  currentDatasets,
  graph,
  selectedSummary,
  missingSelection,
  actionId,
  datasetId,
  canEdit,
  browseOpen,
  pending,
  status,
  refreshState,
  onToggleBrowse,
  onChoosePipeline,
  onChooseFlowgroup,
  onChooseAction,
  onSelectDataset,
  onSelectEdge,
  onAddAction,
  onOpen,
  onCreateFlowgroup,
  onLoadData,
}: GraphWorkspaceProps) {
  const dataLoadDisabled =
    !snapshot.context.trusted ||
    !!pending ||
    !!status?.running ||
    !snapshot.context.runtime.compatible;
  return (
    <>
      <div className="pane-title">
        <button
          className="button quiet small browse-button"
          onClick={onToggleBrowse}
          aria-expanded={browseOpen}
          aria-controls="designer-browse"
        >
          Browse
        </button>
        <h2>
          {mode === 'project'
            ? 'Project dependency map'
            : mode === 'data'
              ? 'Declared data lineage'
              : mode === 'flowgroup'
                ? `${flowgroup?.name ?? 'Missing flowgroup'} · actions`
                : `${pipeline?.name ?? 'Missing pipeline'} · flowgroups`}
        </h2>
        <span className="subtitle">
          {mode === 'project'
            ? sandbox?.mode === 'on' &&
              sandbox.display === 'selected' &&
              sandbox.valid &&
              sandbox.scopeComplete
              ? `${sandbox.selectedPipelines.length} of ${sandbox.totalPipelines} selected · upstream inputs shown`
              : `${snapshot.pipelines.length} pipelines`
            : mode === 'data'
              ? `${currentDatasets?.datasets.length ?? '—'} datasets · all authored`
              : mode === 'flowgroup'
                ? 'Action dependencies'
                : 'Flowgroup dependencies'}
        </span>
      </div>
      {mode === 'pipeline' && (visiblePipelines.length > 1 || !!missingSelection) && (
        <div className="graph-context-bar">
          <label htmlFor="pipeline-graph-choice">Pipeline</label>
          <select
            id="pipeline-graph-choice"
            className="select"
            value={pipeline?.name ?? ''}
            onChange={(event) => onChoosePipeline(event.target.value)}
          >
            {missingSelection === 'pipeline' && (
              <option value="" disabled>
                Choose a current pipeline…
              </option>
            )}
            {visiblePipelines.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === 'flowgroup' && flowgroup && (
        <div className="toolbar">
          <button
            className="button quiet small"
            onClick={() => onChoosePipeline(flowgroup.pipeline)}
          >
            ← Pipeline graph
          </button>
          <button className="button secondary small" onClick={() => onOpen(flowgroup.source)}>
            Open owning YAML
          </button>
          <span className="toolbar-spacer" />
          <button
            className="button small"
            onClick={onAddAction}
            disabled={!canEdit || !flowgroup.editable}
          >
            + Add action
          </button>
        </div>
      )}
      {mode === 'project' && (
        <div className="graph-context-bar">
          <span>
            {sandbox?.mode === 'on' &&
            sandbox.display === 'selected' &&
            sandbox.valid &&
            sandbox.scopeComplete
              ? 'Selected pipelines and their upstream context · Show all changes this view only'
              : 'Dependencies between pipelines in this project'}
          </span>
          <span className="toolbar-spacer" />
          <button
            className="button accent-secondary small"
            onClick={onCreateFlowgroup}
            disabled={!canEdit}
          >
            + Flowgroup / pipeline
          </button>
        </div>
      )}
      {mode === 'data' && (
        <>
          <div className="graph-context-bar">
            <span>
              All authored lineage for {snapshot.context.environment}; no live warehouse query
            </span>
            {currentDatasets?.stale && <span className="badge warn">Lineage may be stale</span>}
            <span className="toolbar-spacer" />
            <button
              className="button secondary small"
              onClick={onLoadData}
              disabled={dataLoadDisabled}
            >
              Refresh lineage
            </button>
          </div>
          {!!currentDatasets?.warnings.length && (
            <details className="data-warnings">
              <summary>{currentDatasets.warnings.length} lineage warnings</summary>
              <ul>
                {currentDatasets.warnings.map((warning, index) => (
                  <li key={`${index}:${warning}`}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {graph ? (
        <GraphPanel
          graph={graph}
          selectedId={
            mode === 'flowgroup'
              ? actionId
              : mode === 'data'
                ? datasetId
                : mode === 'pipeline'
                  ? selectedSummary?.id
                  : undefined
          }
          onSelect={(id) => {
            if (mode === 'flowgroup') onChooseAction(id);
            else if (mode === 'data') onSelectDataset(id);
            else if (mode === 'project') onChoosePipeline(id);
            else onChooseFlowgroup(id);
          }}
          onEdgeSelect={onSelectEdge}
          emptyTitle={
            mode === 'project'
              ? 'No pipelines yet'
              : mode === 'data'
                ? 'No declared datasets found'
                : mode === 'flowgroup'
                  ? 'No actions in this flowgroup'
                  : 'No flowgroups in this pipeline'
          }
          emptyDescription={
            mode === 'project'
              ? 'Create a flowgroup or use the files-to-bronze guide to start a pipeline.'
              : mode === 'data'
                ? 'Declared lineage appears after LHP resolves project datasets for this environment.'
                : mode === 'flowgroup'
                  ? 'Add the first action or open the YAML source.'
                  : 'Create a flowgroup with the files-to-bronze guide or native YAML.'
          }
        />
      ) : (
        <div className="empty">
          <h2>
            {missingSelection
              ? `Selected ${missingSelection} no longer exists`
              : mode === 'data' && !currentDatasets
                ? 'Data lineage has not loaded'
                : !snapshot.context.runtime.compatible
                  ? 'Pipeline graph unavailable'
                  : refreshState === 'failed'
                    ? 'Project graph could not load'
                    : refreshState === 'loading'
                      ? 'Refreshing project graph…'
                      : 'No graph available'}
          </h2>
          <p>
            {missingSelection === 'pipeline'
              ? 'Choose another pipeline above or use Project map. The previous selection was not replaced automatically.'
              : missingSelection === 'flowgroup'
                ? 'Choose a current flowgroup in Browse or the native Pipelines view. The previous selection was not replaced automatically.'
                : mode === 'data' && !currentDatasets
                  ? 'Choose Refresh lineage to inspect declared datasets and their source actions.'
                  : !snapshot.context.runtime.compatible
                    ? 'Choose a Python interpreter that can load the LHP editor integration.'
                    : refreshState === 'failed'
                      ? 'Choose Refresh to retry loading this project.'
                      : refreshState === 'loading'
                        ? 'The pipeline view will appear when refresh finishes.'
                        : 'Choose a pipeline or create a flowgroup.'}
          </p>
          {mode === 'data' && !currentDatasets && (
            <button className="button accent" onClick={onLoadData} disabled={dataLoadDisabled}>
              Load lineage
            </button>
          )}
        </div>
      )}
    </>
  );
}
