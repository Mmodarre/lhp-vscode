import type { DatasetEntry, DatasetSource, SourceRef } from '../../../src/shared/protocol';

interface DataInspectorProps {
  dataset: DatasetEntry;
  onOpen: (source: SourceRef) => void;
  onSelectOwner: (source: DatasetSource) => void;
}

function SourceList({
  title,
  sources,
  onOpen,
  onSelectOwner,
}: {
  title: string;
  sources: DatasetSource[];
  onOpen: (source: SourceRef) => void;
  onSelectOwner: (source: DatasetSource) => void;
}) {
  return (
    <section className="inspector-group">
      <h3>
        {title} · {sources.length}
      </h3>
      {sources.length === 0 && <p className="field-help">None declared in this project.</p>}
      {sources.map((item, index) => (
        <div className="dataset-source" key={`${item.label}-${item.source?.path ?? ''}-${index}`}>
          <span className="dataset-source-name" title={item.label}>
            {item.label}
          </span>
          {item.source ? (
            <button className="link-button" onClick={() => onOpen(item.source!)}>
              Open {item.source.path}
            </button>
          ) : (
            <span className="field-help">No local source location</span>
          )}
          {item.flowgroupId && item.pipeline && (
            <button className="button quiet small" onClick={() => onSelectOwner(item)}>
              Show action graph
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

export function DataInspector({ dataset, onOpen, onSelectOwner }: DataInspectorProps) {
  return (
    <div className="inspector-body">
      <p className="eyebrow">Declared lineage · {dataset.kind}</p>
      <h2 className="inspector-title">{dataset.name}</h2>
      {dataset.kind === 'external' && (
        <p className="field-help">
          External input. LHP does not own a local definition for this dataset.
        </p>
      )}
      <p className="inspector-subtitle">
        {dataset.upstream.length} upstream · {dataset.downstream.length} downstream
      </p>
      <SourceList
        title="Producers"
        sources={dataset.producers}
        onOpen={onOpen}
        onSelectOwner={onSelectOwner}
      />
      <SourceList
        title="Consumers"
        sources={dataset.consumers}
        onOpen={onOpen}
        onSelectOwner={onSelectOwner}
      />
    </div>
  );
}
