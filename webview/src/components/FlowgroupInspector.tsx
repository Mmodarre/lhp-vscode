import { useEffect, useState, type FormEvent } from 'react';
import type {
  ActionMutation,
  EditorCatalog,
  FlowgroupDetail,
  JsonObject,
  SourceRef,
} from '../../../src/shared/protocol';
import { Fields } from './Fields';

function getDefinitionName(detail: FlowgroupDetail): string | undefined {
  const name = detail.raw.use_template ?? detail.raw.use_blueprint;
  return typeof name === 'string' ? name : undefined;
}

export function FlowgroupInspector({
  detail,
  catalog,
  canEditGraph,
  onOpen,
  onMutate,
  onShowActions,
}: {
  detail: FlowgroupDetail;
  catalog: EditorCatalog;
  canEditGraph: boolean;
  onOpen: (source: SourceRef) => void;
  onMutate: (mutation: ActionMutation) => void;
  onShowActions: () => void;
}) {
  const name = getDefinitionName(detail);
  const definition =
    detail.origin.kind === 'blueprint'
      ? catalog.blueprints.find((item) => item.name === name)
      : catalog.templates.find((item) => item.name === name);
  const parameterKey =
    detail.raw.template_parameters !== undefined
      ? 'template_parameters'
      : detail.raw.parameters !== undefined
        ? 'parameters'
        : 'template_parameters';
  const initial = detail.raw[parameterKey];
  const [parameters, setParameters] = useState<JsonObject>(() =>
    initial && typeof initial === 'object' && !Array.isArray(initial)
      ? (initial as JsonObject)
      : {},
  );
  const [dirty, setDirty] = useState(false);
  const [original, setOriginal] = useState(() => JSON.stringify(initial ?? {}));
  const [submitted, setSubmitted] = useState<string>();
  const [externalChanged, setExternalChanged] = useState(false);
  useEffect(() => {
    const value = detail.raw[parameterKey];
    const next = JSON.stringify(value ?? {});
    if (next === original) return;
    if (next === submitted) {
      setParameters(
        value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {},
      );
      setOriginal(next);
      setDirty(false);
      setSubmitted(undefined);
      setExternalChanged(false);
      return;
    }
    if (dirty) {
      setExternalChanged(true);
      return;
    }
    setParameters(
      value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {},
    );
    setOriginal(next);
    setExternalChanged(false);
  }, [detail.raw, parameterKey, original, dirty, submitted]);
  useEffect(() => {
    const value = detail.raw[parameterKey];
    setParameters(
      value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {},
    );
    setOriginal(JSON.stringify(value ?? {}));
    setSubmitted(undefined);
    setDirty(false);
    setExternalChanged(false);
  }, [detail.id]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canEditGraph || !detail.instanceEditable || !dirty || externalChanged) return;
    setSubmitted(JSON.stringify(parameters));
    onMutate({
      kind: 'configureFlowgroup',
      flowgroupId: detail.id,
      values: { ...detail.raw, [parameterKey]: parameters },
    });
  };
  return (
    <div className="inspector-body">
      <h2 className="inspector-title">{detail.name}</h2>
      <p className="inspector-subtitle">
        {detail.pipeline} · {detail.actions.length} actions · {detail.origin.kind}
      </p>
      <div className="inspector-actions">
        <button className="button secondary small" onClick={() => onOpen(detail.source)}>
          Open flowgroup YAML beside graph
        </button>
        <button className="button quiet small" onClick={onShowActions}>
          Show actions
        </button>
      </div>
      {detail.readOnlyReason && <div className="notice warn">{detail.readOnlyReason}</div>}
      {externalChanged && (
        <div className="notice warn" role="alert">
          The instance YAML changed while these parameters were being edited. Review the latest
          source before applying changes.
          <button
            className="button quiet small"
            onClick={() => {
              const next = detail.raw[parameterKey];
              setParameters(
                next && typeof next === 'object' && !Array.isArray(next)
                  ? (next as JsonObject)
                  : {},
              );
              setOriginal(JSON.stringify(next ?? {}));
              setDirty(false);
              setExternalChanged(false);
            }}
          >
            Discard form draft
          </button>
        </div>
      )}
      {detail.origin.kind !== 'direct' && (
        <section className="inspector-group">
          <h3>Source provenance</h3>
          {detail.origin.kind === 'generated' && (
            <>
              <p className="field-help">
                This flowgroup is generated from project monitoring configuration. Edit its settings
                in native YAML.
              </p>
              <button className="link-button" onClick={() => onOpen(detail.source)}>
                Open project configuration
              </button>
            </>
          )}
          {detail.origin.description && <p className="field-help">{detail.origin.description}</p>}
          {detail.origin.instance && (
            <button className="link-button" onClick={() => onOpen(detail.origin.instance!)}>
              Open instance YAML
            </button>
          )}
          {detail.origin.definition && (
            <button className="link-button" onClick={() => onOpen(detail.origin.definition!)}>
              Open {detail.origin.kind} definition
            </button>
          )}
          {detail.origin.kind !== 'generated' && (
            <p className="field-help">
              Inherited actions belong to the definition. Instance parameters belong to this
              flowgroup.
            </p>
          )}
        </section>
      )}
      {definition && definition.fields.length > 0 && (
        <section className="inspector-group">
          <h3>Instance parameters</h3>
          <form onSubmit={submit}>
            <Fields
              fields={definition.fields}
              value={parameters}
              onChange={(value) => {
                setParameters(value);
                setDirty(true);
              }}
            />
            <button
              className="button small"
              type="submit"
              disabled={!canEditGraph || !detail.instanceEditable || !dirty || externalChanged}
            >
              Apply parameters to YAML
            </button>
          </form>
        </section>
      )}
      <section className="inspector-group">
        <h3>Dependency summary</h3>
        {detail.edges.length === 0 ? (
          <p className="field-help">
            No action-level dependency edges are available for this flowgroup.
          </p>
        ) : (
          <p className="field-help">
            {detail.edges.length} action dependency edge{detail.edges.length === 1 ? '' : 's'}{' '}
            derived from source and target views.
          </p>
        )}
      </section>
    </div>
  );
}
