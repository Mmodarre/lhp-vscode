import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { GraphModel } from '../model';
import { layoutGraph } from '../model';

type CardData = Record<string, unknown> & {
  name: string;
  kicker: string;
  detail: string;
  readonly: boolean;
  activate: (id: string) => void;
  id: string;
};

function CardNode({ data }: NodeProps<Node<CardData>>) {
  return (
    <div>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        className="node-body"
        style={{ width: '100%', border: 0, color: 'inherit', background: 'transparent' }}
        type="button"
        onClick={() => data.activate(data.id)}
        aria-label={`Select ${data.kicker} ${data.name}`}
      >
        <span className="node-kicker">
          {data.kicker}
          {data.readonly ? ' · read only' : ''}
        </span>
        <span className="node-name" title={data.name}>
          {data.name}
        </span>
        <span className="node-detail" title={data.detail}>
          {data.detail}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { card: CardNode };

function FocusLargeGraphSelection({ position }: { position?: { x: number; y: number } }) {
  const { setCenter, viewportInitialized } = useReactFlow();
  useEffect(() => {
    if (!position || !viewportInitialized) return;
    void setCenter(position.x + 80, position.y + 35, { zoom: 0.85, duration: 0 });
  }, [position, setCenter, viewportInitialized]);
  return null;
}

export interface GraphPanelProps {
  graph: GraphModel;
  selectedId?: string;
  onSelect: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}

export function GraphPanel({
  graph,
  selectedId,
  onSelect,
  onEdgeSelect,
  emptyTitle,
  emptyDescription,
}: GraphPanelProps) {
  const positions = useMemo(() => layoutGraph(graph.items, graph.edges), [graph]);
  const nodes = useMemo<Node<CardData>[]>(
    () =>
      graph.items.map((item) => ({
        id: item.id,
        type: 'card',
        className: `lhp-node${item.readonly ? ' readonly' : ''}`,
        position: positions[item.id] ?? { x: 0, y: 0 },
        selected: item.id === selectedId,
        data: { ...item, activate: onSelect },
        draggable: false,
      })),
    [graph.items, onSelect, positions, selectedId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.dataset || undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [graph.edges],
  );
  const largeGraph = graph.items.length > 250;
  if (graph.items.length === 0) {
    return (
      <div className="empty" role="status">
        <h2>{emptyTitle}</h2>
        <p>{emptyDescription}</p>
      </div>
    );
  }
  return (
    <div className="graph-wrap" aria-label="Dependency graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onlyRenderVisibleElements={largeGraph}
        nodeTypes={nodeTypes}
        fitView={!largeGraph}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        minZoom={0.25}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        onEdgeClick={(_, edge) => onEdgeSelect?.(edge.id)}
      >
        {largeGraph && (
          <FocusLargeGraphSelection position={selectedId ? positions[selectedId] : undefined} />
        )}
        <Background gap={18} size={1} color="var(--vscode-panel-border, #555)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="graph-hint">
        Select a node for details. Use Tab to reach nodes and actions.
      </div>
    </div>
  );
}
