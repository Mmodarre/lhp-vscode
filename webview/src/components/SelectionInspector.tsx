import type {
  ActionMutation,
  ActionNode,
  DatasetEntry,
  DatasetSource,
  FlowgroupDetail,
  FlowgroupSummary,
  GraphEdge,
  ProjectSnapshot,
  SourceRef,
} from '../../../src/shared/protocol';
import { ActionInspector } from './ActionInspector';
import { AddActionInspector } from './AddActionInspector';
import { DataInspector } from './DataInspector';
import { EdgeInspector } from './EdgeInspector';
import { FlowgroupInspector } from './FlowgroupInspector';
import { sameSourceRef } from '../model';

interface SelectionInspectorProps {
  snapshot: ProjectSnapshot;
  mode: string;
  flowgroup?: FlowgroupDetail;
  selectedAction?: ActionNode;
  selectedEdge?: GraphEdge;
  selectedSummary?: FlowgroupSummary;
  missingSelection?: 'pipeline' | 'flowgroup';
  selectedDataset?: DatasetEntry;
  canEdit: boolean;
  showAddAction: boolean;
  onCancelAdd: () => void;
  onMutate: (mutation: ActionMutation) => void;
  onOpen: (source: SourceRef) => void;
  onShowUsages: (path: string) => void;
  onShowActions: () => void;
  onChooseFlowgroup: (id: string) => void;
  onSelectOwner: (source: DatasetSource) => void;
}

export function SelectionInspector({
  snapshot,
  mode,
  flowgroup,
  selectedAction,
  selectedEdge,
  selectedSummary,
  missingSelection,
  selectedDataset,
  canEdit,
  showAddAction,
  onCancelAdd,
  onMutate,
  onOpen,
  onShowUsages,
  onShowActions,
  onChooseFlowgroup,
  onSelectOwner,
}: SelectionInspectorProps) {
  return (
    <aside className="inspector" aria-label="Selection inspector">
      {missingSelection ? (
        <div className="inspector-body" role="status">
          <h2 className="inspector-title">Selected {missingSelection} no longer exists</h2>
          <p className="field-help">
            Choose a current item in the native LHP sidebar or Browse. No other source has been
            selected for you.
          </p>
        </div>
      ) : mode === 'flowgroup' && flowgroup && showAddAction ? (
        <AddActionInspector
          flowgroupId={flowgroup.id}
          catalog={snapshot.catalog}
          canEdit={canEdit && flowgroup.editable}
          onCancel={onCancelAdd}
          onMutate={onMutate}
        />
      ) : mode === 'flowgroup' && flowgroup && selectedAction ? (
        <ActionInspector
          action={selectedAction}
          detail={flowgroup}
          catalog={snapshot.catalog}
          canEditGraph={canEdit && flowgroup.editable}
          onOpen={onOpen}
          onMutate={onMutate}
          resourceUsages={snapshot.resourceUsages}
          onShowUsages={onShowUsages}
        />
      ) : mode === 'flowgroup' && flowgroup && selectedEdge ? (
        <EdgeInspector
          edge={selectedEdge}
          detail={flowgroup}
          canEdit={canEdit}
          onMutate={onMutate}
        />
      ) : mode === 'flowgroup' && flowgroup ? (
        <FlowgroupInspector
          detail={flowgroup}
          catalog={snapshot.catalog}
          canEditGraph={canEdit}
          onOpen={onOpen}
          onMutate={onMutate}
          onShowActions={onShowActions}
        />
      ) : mode === 'pipeline' && selectedSummary ? (
        <div className="inspector-body">
          <h2 className="inspector-title">{selectedSummary.name}</h2>
          <p className="inspector-subtitle">
            {selectedSummary.actionCount} actions · {selectedSummary.origin.kind}
          </p>
          <div className="inspector-actions">
            <button className="button small" onClick={() => onChooseFlowgroup(selectedSummary.id)}>
              Open action graph
            </button>
            <button
              className="button secondary small"
              onClick={() => onOpen(selectedSummary.source)}
            >
              {selectedSummary.origin.kind === 'template' ||
              selectedSummary.origin.kind === 'blueprint'
                ? 'Open instance YAML'
                : selectedSummary.origin.kind === 'generated'
                  ? 'Open project configuration'
                  : 'Open source YAML'}
            </button>
          </div>
          {selectedSummary.origin.definition &&
            !sameSourceRef(selectedSummary.source, selectedSummary.origin.definition) && (
              <button
                className="link-button"
                onClick={() => onOpen(selectedSummary.origin.definition!)}
              >
                {selectedSummary.origin.kind === 'generated'
                  ? 'Open monitoring configuration'
                  : `Open ${selectedSummary.origin.kind} definition`}
              </button>
            )}
          {(selectedSummary.origin.kind === 'template' ||
            selectedSummary.origin.kind === 'blueprint') &&
            selectedSummary.origin.instance &&
            !sameSourceRef(selectedSummary.source, selectedSummary.origin.instance) && (
              <button
                className="link-button"
                onClick={() => onOpen(selectedSummary.origin.instance!)}
              >
                Open instance YAML
              </button>
            )}
        </div>
      ) : mode === 'data' && selectedDataset ? (
        <DataInspector dataset={selectedDataset} onOpen={onOpen} onSelectOwner={onSelectOwner} />
      ) : mode === 'data' ? (
        <div className="inspector-body">
          <p className="eyebrow">Declared lineage</p>
          <h2 className="inspector-title">Choose a dataset</h2>
          <p className="field-help">
            Select a dataset node to see its declared producers, consumers and source locations.
            This is not a live Databricks data browser.
          </p>
        </div>
      ) : mode === 'project' ? (
        <div className="inspector-body">
          <p className="eyebrow">Project map</p>
          <h2 className="inspector-title">{snapshot.context.project.name}</h2>
          <p className="inspector-subtitle">
            {snapshot.pipelines.length} pipelines · {snapshot.flowgroups.length} flowgroups
          </p>
          <p className="field-help">
            Choose a pipeline node to inspect its flowgroups. Edges are LHP's declared project
            dependencies.
          </p>
        </div>
      ) : (
        <div className="inspector-body">
          <h2 className="inspector-title">Project</h2>
          <p className="field-help">
            Choose a pipeline, flowgroup, or action to inspect its source and edit options.
          </p>
        </div>
      )}
    </aside>
  );
}
