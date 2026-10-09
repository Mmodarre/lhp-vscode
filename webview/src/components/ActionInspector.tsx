import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  ActionDefinition,
  ActionMutation,
  ActionNode,
  EditorCatalog,
  FlowgroupDetail,
  GraphEdge,
  JsonObject,
  ProjectSnapshot,
  SourceRef,
} from '../../../src/shared/protocol';
import { Fields } from './Fields';
import { sameSourceRef } from '../model';

function definitionFor(action: ActionNode, catalog: EditorCatalog): ActionDefinition | undefined {
  return (
    catalog.actions.find((item) => item.type === action.type && item.subtype === action.subtype) ??
    catalog.actions.find((item) => item.type === action.type && !item.subtype)
  );
}

function OriginLinks({
  origin,
  source,
  onOpen,
}: {
  origin: ActionNode['origin'];
  source: SourceRef;
  onOpen: (source: SourceRef) => void;
}) {
  if (origin.kind === 'direct') return null;
  if (origin.kind === 'generated')
    return (
      <div className="inspector-group">
        <h3>Generated from project configuration</h3>
        <p className="field-help">
          This action is derived from LHP project settings. Edit its monitoring configuration in
          native YAML.
        </p>
        <button className="link-button" onClick={() => onOpen(source)}>
          Open project configuration
        </button>
      </div>
    );
  return (
    <div className="inspector-group">
      <h3>{origin.kind === 'template' ? 'Template' : 'Blueprint'} provenance</h3>
      {origin.description && <p className="field-help">{origin.description}</p>}
      {origin.instance && (
        <button className="link-button" onClick={() => onOpen(origin.instance!)}>
          Open instance YAML
        </button>
      )}
      {origin.definition && (
        <button className="link-button" onClick={() => onOpen(origin.definition!)}>
          Open definition
        </button>
      )}
    </div>
  );
}

function ConnectionEditor({
  action,
  detail,
  canEdit,
  onMutate,
}: {
  action: ActionNode;
  detail: FlowgroupDetail;
  canEdit: boolean;
  onMutate: (mutation: ActionMutation) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [dataset, setDataset] = useState(action.outputs[0] ?? '');
  const targets = detail.actions.filter((candidate) => candidate.id !== action.id);
  const outgoing = detail.edges.filter((edge) => edge.source === action.id);
  useEffect(() => {
    setTargetId('');
    setDataset(action.outputs[0] ?? '');
  }, [action.id, action.outputs]);
  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (!targetId || !dataset.trim() || !canEdit) return;
    onMutate({ kind: 'connect', sourceId: action.id, targetId, dataset: dataset.trim() });
  };
  return (
    <section className="inspector-group" aria-label="Action connections">
      <h3>Connections</h3>
      {outgoing.length === 0 && <p className="field-help">No outgoing action connection.</p>}
      {outgoing.map((edge: GraphEdge) => (
        <div className="field-row" key={edge.id}>
          <span className="field-help" style={{ flex: 1 }}>
            {edge.dataset || 'dependency'} →{' '}
            {detail.actions.find((item) => item.id === edge.target)?.name ?? edge.target}
          </span>
          {edge.editable && canEdit && (
            <button
              className="button quiet small"
              type="button"
              aria-label={`Disconnect ${edge.dataset} from ${edge.target}`}
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
          )}
          {!edge.editable && (
            <span className="badge" title={edge.reason}>
              Read only
            </span>
          )}
        </div>
      ))}
      {canEdit && targets.length > 0 && (
        <form onSubmit={connect}>
          <div className="field">
            <label className="field-label" htmlFor="connect-target">
              Connect to action
            </label>
            <select
              className="select"
              id="connect-target"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Choose action…</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="connect-dataset">
              Output view or dataset
            </label>
            <input
              className="input mono"
              id="connect-dataset"
              value={dataset}
              onChange={(event) => setDataset(event.target.value)}
              list="action-outputs"
            />
            <datalist id="action-outputs">
              {action.outputs.map((name) => (
                <option value={name} key={name} />
              ))}
            </datalist>
          </div>
          <button
            className="button secondary small"
            type="submit"
            disabled={!targetId || !dataset.trim()}
          >
            Connect
          </button>
        </form>
      )}
    </section>
  );
}

export function ActionInspector({
  action,
  detail,
  catalog,
  canEditGraph,
  onOpen,
  onMutate,
  resourceUsages,
  onShowUsages,
}: {
  action: ActionNode;
  detail: FlowgroupDetail;
  catalog: EditorCatalog;
  canEditGraph: boolean;
  onOpen: (source: SourceRef) => void;
  onMutate: (mutation: ActionMutation) => void;
  resourceUsages?: ProjectSnapshot['resourceUsages'];
  onShowUsages?: (path: string) => void;
}) {
  const definition = definitionFor(action, catalog);
  const [draft, setDraft] = useState<JsonObject>(() => structuredClone(action.raw));
  const [original, setOriginal] = useState(() => JSON.stringify(action.raw));
  const [submitted, setSubmitted] = useState<string>();
  const [externalChanged, setExternalChanged] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [duplicateName, setDuplicateName] = useState(`${action.name}_copy`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState(JSON.stringify(action.raw, null, 2));
  const [advancedError, setAdvancedError] = useState('');
  const dirty = JSON.stringify(draft) !== original;
  const canEdit = canEditGraph && action.editable && !externalChanged;

  useEffect(() => {
    const next = JSON.stringify(action.raw);
    if (next === original) return;
    if (next === submitted) {
      setDraft(structuredClone(action.raw));
      setOriginal(next);
      setAdvancedDraft(JSON.stringify(action.raw, null, 2));
      setSubmitted(undefined);
      setExternalChanged(false);
      return;
    }
    if (dirty) {
      setExternalChanged(true);
      return;
    }
    setDraft(structuredClone(action.raw));
    setOriginal(next);
    setAdvancedDraft(JSON.stringify(action.raw, null, 2));
    setExternalChanged(false);
  }, [action.raw, dirty, original, submitted]);
  useEffect(() => {
    setDraft(structuredClone(action.raw));
    setOriginal(JSON.stringify(action.raw));
    setSubmitted(undefined);
    setDuplicateName(`${action.name}_copy`);
    setExternalChanged(false);
    setInvalidFields({});
    setShowAdvanced(false);
    setConfirmDelete(false);
  }, [action.id]);

  const requiredMissing = useMemo(
    () =>
      definition?.fields.some((field) => {
        if (!field.required) return false;
        const segments = field.name.split('.');
        let value: unknown = draft;
        for (const segment of segments)
          value =
            value && typeof value === 'object' && !Array.isArray(value)
              ? (value as JsonObject)[segment]
              : undefined;
        return value === undefined || value === null || value === '';
      }) ?? false,
    [definition, draft],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || requiredMissing || Object.values(invalidFields).some(Boolean)) return;
    setSubmitted(JSON.stringify(draft));
    onMutate({ kind: 'configure', actionId: action.id, values: draft });
  };
  const updateAdvanced = (value: string) => {
    setAdvancedDraft(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Expected object');
      setDraft(parsed as JsonObject);
      setAdvancedError('');
    } catch {
      setAdvancedError('Enter a JSON object before saving.');
    }
  };
  return (
    <div className="inspector-body" key={action.id}>
      <h2 className="inspector-title">{action.name || '(unnamed action)'}</h2>
      <p className="inspector-subtitle">
        {action.type}
        {action.subtype ? ` / ${action.subtype}` : ''} · {action.origin.kind}
      </p>
      <div className="inspector-actions">
        <button className="button secondary small" onClick={() => onOpen(action.source)}>
          Open action YAML beside graph
        </button>
      </div>
      {action.readOnlyReason && <div className="notice warn">{action.readOnlyReason}</div>}
      {!canEditGraph && action.editable && (
        <div className="notice warn">
          Graph editing is paused until this project snapshot is current and the YAML is valid.
        </div>
      )}
      {externalChanged && (
        <div className="notice warn" role="alert">
          The document changed while this form had unsaved edits. Review its latest source before
          editing further.
          <button
            className="button quiet small"
            onClick={() => {
              setDraft(structuredClone(action.raw));
              setOriginal(JSON.stringify(action.raw));
              setExternalChanged(false);
            }}
          >
            Discard form draft
          </button>
        </div>
      )}
      <OriginLinks origin={action.origin} source={action.source} onOpen={onOpen} />
      <section className="inspector-group">
        <h3>Referenced source files</h3>
        {action.relatedFiles.length === 0 && (
          <p className="field-help">
            This action has no separate project source file. Edit its YAML fields instead.
          </p>
        )}
        {action.relatedFiles.map((file, index) => {
          const usage = resourceUsages?.[file.path];
          return (
            <div className="related-source-row" key={`${file.path}-${index}`}>
              <button
                className="link-button"
                onClick={() => onOpen(file)}
                disabled={!file.exists || file.dynamic}
              >
                {file.kind}: {file.path}{' '}
                {file.dynamic ? (
                  <span className="badge warn">dynamic path · target unresolved</span>
                ) : (
                  !file.exists && <span className="badge warn">missing</span>
                )}
              </button>
              {file.referenceSource && !sameSourceRef(file, file.referenceSource) && (
                <button
                  className="link-button"
                  onClick={() => onOpen(file.referenceSource!)}
                  title="Open the YAML field that names this file"
                >
                  YAML reference
                </button>
              )}
              {!file.dynamic && usage && usage.knownUseCount > 0 && onShowUsages && (
                <button
                  className="link-button"
                  onClick={() => onShowUsages(file.path)}
                  title={`${usage.knownUseCount} known uses across the project${usage.usageComplete ? '' : '; more may be unresolved'}${usage.knownLabels.length ? `: ${usage.knownLabels.join(', ')}` : ''}`}
                >
                  {usage.knownUseCount} known use{usage.knownUseCount === 1 ? '' : 's'}
                  {usage.usageComplete ? '' : '+'} · Show usages
                </button>
              )}
            </div>
          );
        })}
        <p className="field-help">
          Source files open in the native editor. Generated output is not edited here.
        </p>
      </section>
      <section className="inspector-group">
        <h3>Parameter context</h3>
        {action.resolved ? (
          <details>
            <summary>Compare authored and core-resolved action mappings</summary>
            <p className="field-help">
              The resolved mapping is returned by LHP inspection. Fields not explicitly resolved by
              the core may still contain dynamic expressions.
            </p>
            <h4>Authored</h4>
            <pre className="context-json">{JSON.stringify(action.raw, null, 2)}</pre>
            <h4>Core-resolved</h4>
            <pre className="context-json">{JSON.stringify(action.resolved, null, 2)}</pre>
          </details>
        ) : (
          <p className="field-help">
            Resolution is unknown for this action. Review its YAML and any instance parameters.
          </p>
        )}
      </section>
      <section className="inspector-group">
        <h3>Configure action</h3>
        {!definition && (
          <p className="field-help">
            No guided form is available for this action type. Open its YAML or edit the complete
            mapping below.
          </p>
        )}
        <form onSubmit={submit}>
          {definition && (
            <Fields
              fields={definition.fields}
              value={draft}
              onChange={(value) => {
                setDraft(value);
                setAdvancedDraft(JSON.stringify(value, null, 2));
              }}
              onValidChange={(name, valid) =>
                setInvalidFields((current) => ({ ...current, [name]: !valid }))
              }
            />
          )}
          <button
            type="button"
            className="button quiet small"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide' : 'Show'} complete mapping
          </button>
          {showAdvanced && (
            <div className="field">
              <label htmlFor="action-advanced" className="field-label">
                Full action mapping (JSON)
              </label>
              <textarea
                id="action-advanced"
                className="textarea mono"
                value={advancedDraft}
                onChange={(event) => updateAdvanced(event.target.value)}
                aria-invalid={!!advancedError}
              />
              {advancedError && (
                <span role="alert" className="field-error">
                  {advancedError}
                </span>
              )}
              <span className="field-help">
                Unknown keys are preserved. Native YAML is the authoritative document.
              </span>
            </div>
          )}
          <button
            className="button small"
            type="submit"
            disabled={
              !canEdit ||
              !dirty ||
              requiredMissing ||
              !!advancedError ||
              Object.values(invalidFields).some(Boolean)
            }
          >
            Apply to YAML
          </button>
        </form>
      </section>
      <ConnectionEditor action={action} detail={detail} canEdit={canEdit} onMutate={onMutate} />
      <section className="inspector-group">
        <h3>Other action changes</h3>
        <div className="field">
          <label className="field-label" htmlFor="duplicate-name">
            Duplicate as
          </label>
          <div className="field-row">
            <input
              className="input"
              id="duplicate-name"
              value={duplicateName}
              onChange={(event) => setDuplicateName(event.target.value)}
            />
            <button
              className="button secondary small"
              disabled={!canEdit || !duplicateName.trim()}
              onClick={() =>
                onMutate({ kind: 'duplicate', actionId: action.id, newName: duplicateName.trim() })
              }
            >
              Duplicate
            </button>
          </div>
        </div>
        {!confirmDelete ? (
          <button
            className="button danger small"
            disabled={!canEdit}
            onClick={() => setConfirmDelete(true)}
          >
            Delete action…
          </button>
        ) : (
          <div className="notice warn">
            <p>Delete {action.name}? Native undo can restore this document edit.</p>
            <div className="inspector-actions">
              <button
                className="button danger small"
                disabled={!canEdit}
                onClick={() => {
                  setConfirmDelete(false);
                  onMutate({ kind: 'delete', actionId: action.id });
                }}
              >
                Delete
              </button>
              <button className="button secondary small" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
