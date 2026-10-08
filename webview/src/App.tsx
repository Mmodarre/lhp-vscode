import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ActionMutation,
  DesignerSelection,
  HostMessage,
  InstanceRequest,
  OperationStatus,
  PreviewResult,
  ProjectSnapshot,
  ProjectSummary,
  SourceRef,
} from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { request, subscribe } from './host';
import type { RequestBody } from './host';
import { actionGraph, documentVersions, pipelineGraph } from './model';
import { GraphPanel } from './components/GraphPanel';
import { ActionInspector } from './components/ActionInspector';
import { AddActionInspector } from './components/AddActionInspector';
import { FlowgroupInspector } from './components/FlowgroupInspector';
import { BronzeWizard } from './components/BronzeWizard';
import { InstanceWizard } from './components/InstanceWizard';
import { ProjectChrome } from './components/ProjectChrome';
import { ProjectSidebar } from './components/ProjectSidebar';
import { EdgeInspector } from './components/EdgeInspector';
import { PreviewPane } from './components/PreviewPane';
import { NoProjectScreen } from './components/NoProjectScreen';

type Mode = 'pipeline' | 'flowgroup' | 'bronze' | 'template' | 'blueprint' | 'preview';

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [trusted, setTrusted] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [protocolError, setProtocolError] = useState('');
  const [status, setStatus] = useState<OperationStatus>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string>();
  const [preview, setPreview] = useState<PreviewResult>();
  const [mode, setMode] = useState<Mode>('pipeline');
  const [pipelineId, setPipelineId] = useState('');
  const [flowgroupId, setFlowgroupId] = useState('');
  const [actionId, setActionId] = useState('');
  const [edgeId, setEdgeId] = useState('');
  const [showAddAction, setShowAddAction] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [navigation, setNavigation] = useState<DesignerSelection>();

  useEffect(() => {
    const unsubscribe = subscribe((incoming: HostMessage) => {
      switch (incoming.type) {
        case 'bootstrap':
          setBootstrapped(true);
          if (incoming.protocolVersion !== PROTOCOL_VERSION) {
            setProtocolError(
              `This panel expects protocol ${PROTOCOL_VERSION}, but the extension host uses ${incoming.protocolVersion}. Reload the window.`,
            );
            break;
          }
          setProjects(incoming.projects);
          setTrusted(incoming.trusted);
          setNavigation(incoming.selection);
          // A project switch may bootstrap before its first snapshot arrives.
          // Clear the previous project's graph instead of presenting it as current.
          setSnapshot(incoming.snapshot);
          if (!incoming.snapshot) {
            setPreview(undefined);
            setMode('pipeline');
            setPipelineId('');
            setFlowgroupId('');
            setActionId('');
            setEdgeId('');
          }
          break;
        case 'select':
          setNavigation(incoming.selection);
          break;
        case 'snapshot':
          setSnapshot((current) =>
            !current ||
            current.context.project.id !== incoming.snapshot.context.project.id ||
            incoming.snapshot.revision >= current.revision
              ? incoming.snapshot
              : current,
          );
          if (incoming.snapshot.refreshState !== 'failed') setError('');
          break;
        case 'status':
          setStatus(incoming.status);
          break;
        case 'preview':
          setPreview(incoming.result);
          setMode('preview');
          break;
        case 'diagnostics':
          setSnapshot((current) =>
            current ? { ...current, diagnostics: incoming.diagnostics } : current,
          );
          break;
        case 'result':
          setPending((current) => (current === incoming.requestId ? undefined : current));
          if (incoming.success) {
            setMessage(incoming.message ?? 'Done.');
            setError('');
          } else {
            setError(incoming.message ?? 'The operation failed.');
            setMessage('');
          }
          break;
        case 'error':
          setPending((current) =>
            !incoming.requestId || current === incoming.requestId ? undefined : current,
          );
          setError(
            `${incoming.message}${incoming.code === 'STALE_DOCUMENT' || incoming.code === 'STALE_CONTEXT' ? ' Refresh and review the latest YAML before retrying.' : ''}`,
          );
          setMessage('');
          break;
      }
    });
    request({ type: 'ready' });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!navigation || !snapshot || snapshot.context.project.id !== navigation.projectId) return;
    if (snapshot.revision < navigation.revision) return;
    if (snapshot.revision !== navigation.revision) {
      setNavigation(undefined);
      return;
    }
    const group = navigation.flowgroupId
      ? snapshot.flowgroups.find((item) => item.id === navigation.flowgroupId)
      : undefined;
    const pipeline = navigation.pipeline
      ? snapshot.pipelines.find((item) => item.name === navigation.pipeline)
      : undefined;
    if (
      (navigation.flowgroupId && !group) ||
      (navigation.pipeline && !pipeline) ||
      (group && navigation.pipeline && group.pipeline !== navigation.pipeline) ||
      (navigation.actionId && !group?.actions.some((item) => item.id === navigation.actionId))
    ) {
      setNavigation(undefined);
      return;
    }
    if (group) {
      setPipelineId(group.pipeline);
      setFlowgroupId(group.id);
      setActionId(navigation.actionId ?? '');
      setMode('flowgroup');
    } else if (pipeline) {
      setPipelineId(pipeline.name);
      setFlowgroupId('');
      setActionId('');
      setMode('pipeline');
    }
    setEdgeId('');
    setShowAddAction(false);
    setShowInspector(true);
    setNavigation(undefined);
  }, [navigation, snapshot]);

  const context = snapshot
    ? { projectId: snapshot.context.project.id, revision: snapshot.revision }
    : undefined;
  const send = useCallback(
    (body: RequestBody, expectUpdate = false) => {
      setMessage('');
      setError('');
      const id = request({ ...body, ...(context ? { context } : {}) } as RequestBody);
      if (expectUpdate) setPending(id);
      return id;
    },
    [context],
  );
  const open = useCallback(
    (source: SourceRef) => {
      send({ type: 'openSource', source });
    },
    [send],
  );
  const mutate = useCallback(
    (mutation: ActionMutation) => {
      if (!snapshot || pending) return;
      send(
        {
          type: 'mutate',
          projectId: snapshot.context.project.id,
          documentVersions: documentVersions(snapshot),
          mutation,
        },
        true,
      );
    },
    [snapshot, pending, send],
  );

  const pipeline =
    snapshot?.pipelines.find((item) => item.name === pipelineId) ?? snapshot?.pipelines[0];
  const flowgroup =
    snapshot?.flowgroups.find((item) => item.id === flowgroupId) ??
    snapshot?.flowgroups.find((item) => item.pipeline === pipeline?.name);
  const selectedAction = flowgroup?.actions.find((action) => action.id === actionId);
  const selectedEdge = flowgroup?.edges.find((edge) => edge.id === edgeId);
  const selectedSummary =
    pipeline?.flowgroups.find((item) => item.id === flowgroupId) ?? pipeline?.flowgroups[0];
  const graph = useMemo(() => {
    if (!snapshot) return undefined;
    return mode === 'flowgroup' && flowgroup
      ? actionGraph(flowgroup)
      : pipeline
        ? pipelineGraph(snapshot, pipeline.name)
        : undefined;
  }, [snapshot, mode, flowgroup, pipeline]);
  const syntaxError =
    snapshot?.diagnostics.some((item) => item.layer === 'syntax' && item.severity === 'error') ??
    false;
  const refreshState = snapshot?.refreshState ?? 'ready';
  const canEdit =
    !!snapshot?.context.trusted &&
    !!snapshot?.context.runtime.compatible &&
    !snapshot.stale &&
    refreshState === 'ready' &&
    !syntaxError &&
    !pending &&
    !status?.running;
  const canUndo = !!snapshot?.context.trusted && !pending && !status?.running;
  const dirtyCount = snapshot?.documents.filter((item) => item.dirty).length ?? 0;
  const canGenerate =
    !!snapshot?.context.trusted &&
    !!snapshot.context.runtime.compatible &&
    !snapshot.stale &&
    refreshState === 'ready' &&
    !syntaxError &&
    !status?.running &&
    !pending;
  const previewStale =
    !!preview &&
    !!snapshot &&
    snapshot.documents.some((doc) => preview.documentVersions[doc.path] !== doc.version);
  const choosePipeline = (name: string) => {
    setPipelineId(name);
    setFlowgroupId('');
    setActionId('');
    setEdgeId('');
    setMode('pipeline');
    setShowAddAction(false);
  };
  const chooseFlowgroup = (id: string) => {
    setFlowgroupId(id);
    setActionId('');
    setEdgeId('');
    setMode('flowgroup');
    setShowAddAction(false);
  };
  const chooseAction = (id: string) => {
    setActionId(id);
    setEdgeId('');
    setShowAddAction(false);
    setShowInspector(true);
    const action = flowgroup?.actions.find((item) => item.id === id);
    if (action) open(action.source);
  };
  const selectProject = (id: string) => {
    setSnapshot(undefined);
    setPreview(undefined);
    setMode('pipeline');
    setMessage('');
    setError('');
    setPending(request({ type: 'selectProject', projectId: id }));
  };
  const createInstance = (values: InstanceRequest) => {
    send({ type: 'createInstance', values }, true);
  };

  if (protocolError)
    return (
      <div className="empty">
        <h2>Extension protocol mismatch</h2>
        <p>{protocolError}</p>
      </div>
    );
  if (!bootstrapped)
    return (
      <div className="empty" role="status">
        <h2>Loading LHP workspace…</h2>
        <p>Waiting for the extension host to identify this project.</p>
      </div>
    );
  if (!snapshot)
    return (
      <NoProjectScreen
        projects={projects}
        trusted={trusted}
        pending={pending}
        status={status}
        error={error}
        selectProject={selectProject}
        send={send}
      />
    );

  const showingGraph = mode === 'pipeline' || mode === 'flowgroup';
  return (
    <div className="app">
      <ProjectChrome
        snapshot={snapshot}
        projects={projects}
        status={status}
        pending={pending}
        dirtyCount={dirtyCount}
        canUndo={canUndo}
        canGenerate={canGenerate}
        syntaxError={syntaxError}
        message={message}
        error={error}
        showInspector={showInspector}
        setShowInspector={setShowInspector}
        setPreview={setPreview}
        selectProject={selectProject}
        send={send}
      />
      <div className={`body${showInspector ? ' with-inspector' : ''}`}>
        <ProjectSidebar
          snapshot={snapshot}
          mode={mode}
          pipelineName={pipeline?.name}
          flowgroupId={flowgroup?.id}
          canEdit={canEdit}
          choosePipeline={choosePipeline}
          chooseFlowgroup={chooseFlowgroup}
          onCreateMode={setMode}
          send={send}
        />
        <main className="main">
          {showingGraph && (
            <>
              <div className="pane-title">
                <h2>
                  {mode === 'flowgroup'
                    ? `${flowgroup?.name ?? 'Flowgroup'} · actions`
                    : `${pipeline?.name ?? 'Pipeline'} · flowgroups`}
                </h2>
                <span className="subtitle">
                  {mode === 'flowgroup' ? 'Action dependencies' : 'Flowgroup dependencies'}
                </span>
              </div>
              {mode === 'flowgroup' && flowgroup && (
                <div className="toolbar">
                  <button
                    className="button quiet small"
                    onClick={() => choosePipeline(flowgroup.pipeline)}
                  >
                    ← Pipeline graph
                  </button>
                  <button className="button secondary small" onClick={() => open(flowgroup.source)}>
                    Open YAML
                  </button>
                  <span className="toolbar-spacer" />
                  <button
                    className="button small"
                    onClick={() => {
                      setShowAddAction(true);
                      setActionId('');
                      setEdgeId('');
                      setShowInspector(true);
                    }}
                    disabled={!canEdit || !flowgroup.editable}
                  >
                    + Add action
                  </button>
                </div>
              )}
              {graph ? (
                <GraphPanel
                  graph={graph}
                  selectedId={mode === 'flowgroup' ? actionId : selectedSummary?.id}
                  onSelect={(id) => (mode === 'flowgroup' ? chooseAction(id) : chooseFlowgroup(id))}
                  onEdgeSelect={(id) => {
                    setEdgeId(id);
                    setActionId('');
                    setShowInspector(true);
                  }}
                  emptyTitle={
                    mode === 'flowgroup'
                      ? 'No actions in this flowgroup'
                      : 'No flowgroups in this pipeline'
                  }
                  emptyDescription={
                    mode === 'flowgroup'
                      ? 'Add the first action or open the YAML source.'
                      : 'Create a flowgroup with the files-to-bronze guide or native YAML.'
                  }
                />
              ) : (
                <div className="empty">
                  <h2>
                    {!snapshot.context.runtime.compatible
                      ? 'Pipeline graph unavailable'
                      : refreshState === 'failed'
                        ? 'Project graph could not load'
                        : refreshState === 'loading'
                          ? 'Refreshing project graph…'
                          : 'No graph available'}
                  </h2>
                  <p>
                    {!snapshot.context.runtime.compatible
                      ? 'Choose a Python interpreter that can load the LHP editor integration.'
                      : refreshState === 'failed'
                        ? 'Choose Refresh to retry loading this project.'
                        : refreshState === 'loading'
                          ? 'The pipeline view will appear when refresh finishes.'
                          : 'Choose a pipeline or create a flowgroup.'}
                  </p>
                </div>
              )}
            </>
          )}
          {mode === 'bronze' && (
            <BronzeWizard
              pipelines={snapshot.pipelines.map((item) => item.name)}
              busy={!!pending}
              onCancel={() => setMode('pipeline')}
              onCreate={(values) => send({ type: 'createBronze', values }, true)}
            />
          )}
          {(mode === 'template' || mode === 'blueprint') && (
            <InstanceWizard
              key={mode}
              kind={mode}
              catalog={snapshot.catalog}
              pipelines={snapshot.pipelines.map((item) => item.name)}
              busy={!!pending}
              onCancel={() => setMode('pipeline')}
              onCreate={createInstance}
              onOpen={open}
            />
          )}
          {mode === 'preview' && (
            <PreviewPane
              preview={preview}
              previewStale={previewStale}
              onShowFile={(path) => send({ type: 'showPreviewFile', path })}
              onBack={() => setMode('pipeline')}
            />
          )}
        </main>
        {showInspector && (
          <aside className="inspector" aria-label="Selection inspector">
            {mode === 'flowgroup' && flowgroup && showAddAction ? (
              <AddActionInspector
                flowgroupId={flowgroup.id}
                catalog={snapshot.catalog}
                canEdit={canEdit && flowgroup.editable}
                onCancel={() => setShowAddAction(false)}
                onMutate={mutate}
              />
            ) : mode === 'flowgroup' && flowgroup && selectedAction ? (
              <ActionInspector
                action={selectedAction}
                detail={flowgroup}
                catalog={snapshot.catalog}
                canEditGraph={canEdit && flowgroup.editable}
                onOpen={open}
                onMutate={mutate}
              />
            ) : mode === 'flowgroup' && flowgroup && selectedEdge ? (
              <EdgeInspector
                edge={selectedEdge}
                detail={flowgroup}
                canEdit={canEdit}
                onMutate={mutate}
              />
            ) : mode === 'flowgroup' && flowgroup ? (
              <FlowgroupInspector
                detail={flowgroup}
                catalog={snapshot.catalog}
                canEditGraph={canEdit}
                onOpen={open}
                onMutate={mutate}
                onShowActions={() => setActionId(flowgroup.actions[0]?.id ?? '')}
              />
            ) : mode === 'pipeline' && selectedSummary ? (
              <div className="inspector-body">
                <h2 className="inspector-title">{selectedSummary.name}</h2>
                <p className="inspector-subtitle">
                  {selectedSummary.actionCount} actions · {selectedSummary.origin.kind}
                </p>
                <div className="inspector-actions">
                  <button
                    className="button small"
                    onClick={() => chooseFlowgroup(selectedSummary.id)}
                  >
                    Open action graph
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => open(selectedSummary.source)}
                  >
                    Open source YAML
                  </button>
                </div>
                {selectedSummary.origin.definition && (
                  <button
                    className="link-button"
                    onClick={() => open(selectedSummary.origin.definition!)}
                  >
                    Open {selectedSummary.origin.kind} definition
                  </button>
                )}
                {selectedSummary.origin.instance && (
                  <button
                    className="link-button"
                    onClick={() => open(selectedSummary.origin.instance!)}
                  >
                    Open instance YAML
                  </button>
                )}
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
        )}
      </div>
      <footer className="statusbar" role="status">
        <span>{snapshot.context.environment} environment</span>
        <span>·</span>
        <span>{snapshot.context.runtime.lhpVersion ?? 'LHP runtime unavailable'}</span>
        <span>·</span>
        <span>
          {!snapshot.context.runtime.compatible || refreshState !== 'ready'
            ? 'Validation unavailable'
            : `${snapshot.diagnostics.filter((item) => item.severity === 'error').length} errors, ${snapshot.diagnostics.filter((item) => item.severity === 'warning').length} warnings`}
        </span>
        <span className="spacer" />
        {status?.message && <span>{status.message}</span>}
        <span>Revision {snapshot.revision}</span>
      </footer>
    </div>
  );
}
