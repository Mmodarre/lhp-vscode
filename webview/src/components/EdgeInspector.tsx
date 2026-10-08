import type {
  ActionMutation,
  ActionNode,
  FlowgroupDetail,
  GraphEdge,
} from '../../../src/shared/protocol';

export function EdgeInspector({
  edge,
  detail,
  canEdit,
  onMutate,
}: {
  edge: GraphEdge;
  detail: FlowgroupDetail;
  canEdit: boolean;
  onMutate: (mutation: ActionMutation) => void;
}) {
  const from =
    detail.actions.find((item: ActionNode) => item.id === edge.source)?.name ?? edge.source;
  const to =
    detail.actions.find((item: ActionNode) => item.id === edge.target)?.name ?? edge.target;
  return (
    <div className="inspector-body">
      <h2 className="inspector-title">Action dependency</h2>
      <p className="inspector-subtitle">
        {from} → {to}
      </p>
      <p className="mono">{edge.dataset || 'Unlabelled dependency'}</p>
      {edge.reason && <div className="notice warn">{edge.reason}</div>}
      <button
        className="button danger small"
        disabled={!canEdit || !edge.editable}
        onClick={() =>
          onMutate({
            kind: 'disconnect',
            sourceId: edge.source,
            targetId: edge.target,
            dataset: edge.dataset,
          })
        }
      >
        Disconnect
      </button>
    </div>
  );
}
