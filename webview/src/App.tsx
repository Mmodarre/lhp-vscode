import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActionMutation,
  DesignerSelection,
  HostMessage,
  InstanceRequest,
  OperationStatus,
  PreviewResult,
  ProjectDatasetIndex,
  ProjectSnapshot,
  ProjectSummary,
  SandboxViewState,
  SourceRef,
} from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { request, subscribe } from './host';
import type { RequestBody } from './host';
import { actionGraph, datasetGraph, documentVersions, pipelineGraph, projectGraph } from './model';
import { GraphWorkspace } from './components/GraphWorkspace';
import { SelectionInspector } from './components/SelectionInspector';
import { DesignerStatus } from './components/DesignerStatus';
import { BronzeWizard } from './components/BronzeWizard';
import { InstanceWizard } from './components/InstanceWizard';
import { ProjectChrome } from './components/ProjectChrome';
import { ProjectSidebar } from './components/ProjectSidebar';
import { PreviewPane } from './components/PreviewPane';
import { NoProjectScreen } from './components/NoProjectScreen';
import { FlowgroupWizard } from './components/FlowgroupWizard';

type Mode =
  | 'project'
  | 'pipeline'
  | 'flowgroup'
  | 'data'
  | 'bronze'
  | 'new-flowgroup'
  | 'template'
  | 'blueprint'
  | 'preview';

export function App() {
  const activeProjectRef = useRef<string | undefined>(undefined);
  const activeRevisionRef = useRef(0);
  const feedbackGenerationRef = useRef(0);
  const requestGenerationRef = useRef(new Map<string, number>());
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [logoUri, setLogoUri] = useState<string>();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [datasets, setDatasets] = useState<ProjectDatasetIndex>();
  const [trusted, setTrusted] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [protocolError, setProtocolError] = useState('');
  const [status, setStatus] = useState<OperationStatus>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string>();
  const [preview, setPreview] = useState<PreviewResult>();
  const [sandboxUpdate, setSandboxUpdate] = useState<SandboxViewState>();
  const [mode, setMode] = useState<Mode>('pipeline');
  const [pipelineId, setPipelineId] = useState('');
  const [flowgroupId, setFlowgroupId] = useState('');
  const [actionId, setActionId] = useState('');
  const [edgeId, setEdgeId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [instanceDefinition, setInstanceDefinition] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [showAddAction, setShowAddAction] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [navigation, setNavigation] = useState<DesignerSelection>();
  const [queuedGuide, setQueuedGuide] = useState<Extract<HostMessage, { type: 'guide' }>>();

  useEffect(() => {
    const resetForProject = (projectId?: string) => {
      if (activeProjectRef.current === projectId) return;
      activeProjectRef.current = projectId;
      activeRevisionRef.current = 0;
      feedbackGenerationRef.current++;
      requestGenerationRef.current.clear();
      setPreview(undefined);
      setSandboxUpdate(undefined);
      setDatasets(undefined);
      setMode('pipeline');
      setPipelineId('');
      setFlowgroupId('');
      setActionId('');
      setEdgeId('');
      setDatasetId('');
      setBrowseOpen(false);
      setShowAddAction(false);
      setInstanceDefinition('');
      setStatus(undefined);
      setPending(undefined);
      setError('');
      setMessage('');
    };
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
          resetForProject(incoming.snapshot?.context.project.id);
          activeRevisionRef.current = incoming.snapshot?.revision ?? 0;
          setProjects(incoming.projects);
          setLogoUri(incoming.logoUri);
          setTrusted(incoming.trusted);
          setNavigation(incoming.selection);
          setDatasets(incoming.datasets);
          // A project switch may bootstrap before its first snapshot arrives.
          // Clear the previous project's graph instead of presenting it as current.
          setSnapshot(incoming.snapshot);
          setSandboxUpdate(incoming.sandbox ?? incoming.snapshot?.sandbox);
          break;
        case 'select':
          setNavigation(incoming.selection);
          break;
        case 'datasets':
          setDatasets(incoming.datasets);
          break;
        case 'guide':
          setQueuedGuide(incoming);
          break;
        case 'snapshot':
          resetForProject(incoming.snapshot.context.project.id);
          if (incoming.snapshot.revision < activeRevisionRef.current) break;
          activeRevisionRef.current = incoming.snapshot.revision;
          setSandboxUpdate(incoming.snapshot.sandbox);
          setSnapshot((current) =>
            !current ||
            current.context.project.id !== incoming.snapshot.context.project.id ||
            incoming.snapshot.revision >= current.revision
              ? incoming.snapshot
              : current,
          );
          if (incoming.snapshot.refreshState !== 'failed') setError('');
          break;
        case 'sandbox':
          if (
            incoming.projectId !== activeProjectRef.current ||
            incoming.revision < activeRevisionRef.current
          )
            break;
          setSandboxUpdate(incoming.sandbox);
          setPreview(undefined);
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
          if (
            requestGenerationRef.current.get(incoming.requestId) !== feedbackGenerationRef.current
          )
            break;
          requestGenerationRef.current.delete(incoming.requestId);
          setPending((current) => (current === incoming.requestId ? undefined : current));
          if (incoming.success) {
            if (incoming.message) {
              setMessage(incoming.message);
              setError('');
            }
          } else {
            setError(incoming.message ?? 'The operation failed.');
            setMessage('');
          }
          break;
        case 'error':
          // Unscoped host errors may arrive after a project switch. The native
          // notification and refreshed snapshot still surface those failures.
          if (
            !incoming.requestId ||
            requestGenerationRef.current.get(incoming.requestId) !== feedbackGenerationRef.current
          )
            break;
          requestGenerationRef.current.delete(incoming.requestId);
          setPending((current) => (current === incoming.requestId ? undefined : current));
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
    if (navigation.view === 'project') {
      setMode('project');
      setActionId('');
      setEdgeId('');
    } else if (navigation.view === 'dataset') {
      setMode('data');
      setDatasetId(navigation.datasetId ?? '');
      setActionId('');
      setEdgeId('');
    } else if (group) {
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
    setBrowseOpen(false);
    setNavigation(undefined);
  }, [navigation, snapshot]);

  useEffect(() => {
    if (!queuedGuide || !snapshot || queuedGuide.projectId !== snapshot.context.project.id) return;
    if (snapshot.revision < queuedGuide.revision) return;
    if (snapshot.revision === queuedGuide.revision) {
      setInstanceDefinition(queuedGuide.definition ?? '');
      setMode(queuedGuide.guide === 'flowgroup' ? 'new-flowgroup' : queuedGuide.guide);
      setBrowseOpen(false);
    }
    setQueuedGuide(undefined);
  }, [queuedGuide, snapshot]);

  const context = snapshot
    ? { projectId: snapshot.context.project.id, revision: snapshot.revision }
    : undefined;
  const send = useCallback(
    (body: RequestBody, expectUpdate = false) => {
      setMessage('');
      setError('');
      const id = request({ ...body, ...(context ? { context } : {}) } as RequestBody);
      requestGenerationRef.current.set(id, feedbackGenerationRef.current);
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

  const sandbox = sandboxUpdate ?? snapshot?.sandbox;
  const selectedOnly =
    sandbox?.mode === 'on' &&
    sandbox.display === 'selected' &&
    sandbox.valid &&
    sandbox.scopeComplete;
  const visiblePipelines =
    snapshot?.pipelines.filter(
      (item) => !selectedOnly || sandbox?.selectedPipelines.includes(item.name),
    ) ?? [];
  useEffect(() => {
    if (
      !selectedOnly ||
      !pipelineId ||
      !snapshot?.pipelines.some((item) => item.name === pipelineId)
    )
      return;
    if (visiblePipelines.some((item) => item.name === pipelineId)) return;
    setPipelineId(visiblePipelines[0]?.name ?? '');
    setFlowgroupId('');
    setActionId('');
    setMode('pipeline');
  }, [
    selectedOnly,
    pipelineId,
    snapshot?.pipelines,
    visiblePipelines.map((item) => item.name).join('\0'),
  ]);
  const pipeline = pipelineId
    ? visiblePipelines.find((item) => item.name === pipelineId)
    : visiblePipelines[0];
  const flowgroup = flowgroupId
    ? snapshot?.flowgroups.find((item) => item.id === flowgroupId)
    : snapshot?.flowgroups.find((item) => item.pipeline === pipeline?.name);
  const selectedAction = flowgroup?.actions.find((action) => action.id === actionId);
  const selectedEdge = flowgroup?.edges.find((edge) => edge.id === edgeId);
  const selectedSummary = flowgroupId
    ? pipeline?.flowgroups.find((item) => item.id === flowgroupId)
    : pipeline?.flowgroups[0];
  const missingSelection =
    mode === 'pipeline' && pipelineId && !pipeline
      ? 'pipeline'
      : mode === 'flowgroup' && flowgroupId && !flowgroup
        ? 'flowgroup'
        : undefined;
  const currentDatasets =
    datasets &&
    snapshot &&
    datasets.projectId === snapshot.context.project.id &&
    datasets.revision === snapshot.revision &&
    datasets.environment === snapshot.context.environment
      ? datasets
      : undefined;
  const selectedDataset = currentDatasets?.datasets.find((item) => item.id === datasetId);
  // The host retains graph arrays while diagnostics and document dirty flags
  // change. Keep large graph layout stable across those lightweight updates.
  const graph = useMemo(() => {
    if (!snapshot) return undefined;
    if (mode === 'project')
      return projectGraph(snapshot, selectedOnly ? new Set(sandbox?.selectedPipelines) : undefined);
    if (mode === 'data') return currentDatasets ? datasetGraph(currentDatasets) : undefined;
    if (mode === 'flowgroup') return flowgroup ? actionGraph(flowgroup) : undefined;
    return pipeline ? pipelineGraph(snapshot, pipeline.name) : undefined;
  }, [
    mode,
    flowgroup,
    pipeline,
    currentDatasets,
    snapshot?.pipelines,
    snapshot?.flowgroupEdges,
    snapshot?.pipelineEdges,
    sandbox?.selectedPipelines,
    selectedOnly,
  ]);
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
    !pending &&
    (sandbox?.mode !== 'on' ||
      (sandbox.valid &&
        !sandbox.stale &&
        sandbox.scopeComplete &&
        sandbox.profileSource === 'saved'));
  const previewStale =
    !!preview &&
    !!snapshot &&
    (snapshot.documents.some((doc) => preview.documentVersions[doc.path] !== doc.version) ||
      (preview.mode !== undefined && preview.mode !== sandbox?.mode) ||
      (preview.environment !== undefined && preview.environment !== snapshot.context.environment) ||
      (preview.namespace !== undefined && preview.namespace !== sandbox?.namespace));
  const choosePipeline = (name: string) => {
    setPipelineId(name);
    setFlowgroupId('');
    setActionId('');
    setEdgeId('');
    setMode('pipeline');
    setShowAddAction(false);
    setBrowseOpen(false);
  };
  const chooseFlowgroup = (id: string) => {
    setFlowgroupId(id);
    setActionId('');
    setEdgeId('');
    setMode('flowgroup');
    setShowAddAction(false);
    setBrowseOpen(false);
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
    feedbackGenerationRef.current++;
    requestGenerationRef.current.clear();
    setQueuedGuide(undefined);
    setSnapshot(undefined);
    setPreview(undefined);
    setSandboxUpdate(undefined);
    setMode('pipeline');
    setMessage('');
    setError('');
    const requestId = request({ type: 'selectProject', projectId: id });
    requestGenerationRef.current.set(requestId, feedbackGenerationRef.current);
    setPending(requestId);
    setDatasets(undefined);
  };
  const chooseData = () => {
    setMode('data');
    setBrowseOpen(false);
    if (snapshot?.context.trusted && !currentDatasets && !status?.running && !pending)
      send({ type: 'loadData' }, true);
  };
  const chooseCreate = (next: 'bronze' | 'template' | 'blueprint' | 'new-flowgroup') => {
    setMode(next);
    setInstanceDefinition('');
    setBrowseOpen(false);
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
        logoUri={logoUri}
        projects={projects}
        trusted={trusted}
        pending={pending}
        status={status}
        error={error}
        selectProject={selectProject}
        send={send}
      />
    );

  const showingGraph =
    mode === 'project' || mode === 'pipeline' || mode === 'flowgroup' || mode === 'data';
  const inspectorVisible = showInspector && mode !== 'preview';
  return (
    <div className="app">
      <ProjectChrome
        logoUri={logoUri}
        mode={mode}
        snapshot={snapshot}
        projects={projects}
        status={status}
        pending={pending}
        dirtyCount={dirtyCount}
        canUndo={canUndo}
        canGenerate={canGenerate}
        sandbox={sandbox}
        syntaxError={syntaxError}
        message={message}
        error={error}
        showInspector={showInspector}
        canEdit={canEdit}
        setShowInspector={setShowInspector}
        setPreview={setPreview}
        selectProject={selectProject}
        onProjectMap={() => {
          setMode('project');
          setBrowseOpen(false);
        }}
        onData={chooseData}
        onCreate={chooseCreate}
        send={send}
      />
      <div className={`body${inspectorVisible ? ' with-inspector' : ''}`}>
        {browseOpen && (
          <ProjectSidebar
            snapshot={snapshot}
            visiblePipelines={visiblePipelines}
            sandbox={sandbox}
            mode={mode}
            pipelineName={pipeline?.name}
            flowgroupId={flowgroup?.id}
            canEdit={canEdit}
            choosePipeline={choosePipeline}
            chooseFlowgroup={chooseFlowgroup}
            onCreateMode={chooseCreate}
            send={send}
            onOpen={open}
            onClose={() => setBrowseOpen(false)}
          />
        )}
        <main className="main">
          {showingGraph && (
            <GraphWorkspace
              snapshot={snapshot}
              visiblePipelines={visiblePipelines}
              sandbox={sandbox}
              mode={mode}
              pipeline={pipeline}
              flowgroup={flowgroup}
              currentDatasets={currentDatasets}
              graph={graph}
              selectedSummary={selectedSummary}
              missingSelection={missingSelection}
              actionId={actionId}
              datasetId={datasetId}
              canEdit={canEdit}
              browseOpen={browseOpen}
              pending={pending}
              status={status}
              refreshState={refreshState}
              onToggleBrowse={() => setBrowseOpen(!browseOpen)}
              onChoosePipeline={choosePipeline}
              onChooseFlowgroup={chooseFlowgroup}
              onChooseAction={chooseAction}
              onSelectDataset={(id) => {
                setDatasetId(id);
                setShowInspector(true);
              }}
              onSelectEdge={(id) => {
                setEdgeId(id);
                setActionId('');
                setShowInspector(true);
              }}
              onAddAction={() => {
                setShowAddAction(true);
                setActionId('');
                setEdgeId('');
                setShowInspector(true);
              }}
              onOpen={open}
              onCreateFlowgroup={() => chooseCreate('new-flowgroup')}
              onLoadData={() => send({ type: 'loadData' }, true)}
            />
          )}
          {mode === 'bronze' && (
            <BronzeWizard
              pipelines={snapshot.pipelines.map((item) => item.name)}
              busy={!canEdit}
              onCancel={() => setMode('pipeline')}
              onCreate={(values) => send({ type: 'createBronze', values }, true)}
            />
          )}
          {mode === 'new-flowgroup' && (
            <FlowgroupWizard
              pipelines={snapshot.pipelines.map((item) => item.name)}
              busy={!canEdit}
              onCancel={() => setMode('pipeline')}
              onCreate={(values) => send({ type: 'createFlowgroup', values }, true)}
            />
          )}
          {(mode === 'template' || mode === 'blueprint') && (
            <InstanceWizard
              key={`${mode}:${instanceDefinition}`}
              kind={mode}
              initialDefinition={instanceDefinition}
              catalog={snapshot.catalog}
              pipelines={snapshot.pipelines.map((item) => item.name)}
              busy={!canEdit}
              onCancel={() => setMode('pipeline')}
              onCreate={createInstance}
              onOpen={open}
            />
          )}
          {mode === 'preview' && (
            <PreviewPane
              preview={preview}
              previewStale={previewStale}
              sandbox={sandbox}
              onShowFile={(path) => send({ type: 'showPreviewFile', path })}
              onBack={() => setMode('pipeline')}
            />
          )}
        </main>
        {inspectorVisible && (
          <SelectionInspector
            snapshot={snapshot}
            mode={mode}
            flowgroup={flowgroup}
            selectedAction={selectedAction}
            selectedEdge={selectedEdge}
            selectedSummary={selectedSummary}
            missingSelection={missingSelection}
            selectedDataset={selectedDataset}
            canEdit={canEdit}
            showAddAction={showAddAction}
            onCancelAdd={() => setShowAddAction(false)}
            onMutate={mutate}
            onOpen={open}
            onShowUsages={(path) => send({ type: 'showUsages', path })}
            onShowActions={() => setActionId(flowgroup?.actions[0]?.id ?? '')}
            onChooseFlowgroup={chooseFlowgroup}
            onSelectOwner={(source) => {
              if (!source.flowgroupId) return;
              const owner = snapshot.flowgroups.find((item) => item.id === source.flowgroupId);
              if (!owner) {
                setError(
                  'This dataset owner is no longer in the current project graph. Open its source file or refresh lineage.',
                );
                return;
              }
              setError('');
              choosePipeline(owner.pipeline);
              chooseFlowgroup(owner.id);
              if (source.actionId && owner.actions.some((action) => action.id === source.actionId))
                setActionId(source.actionId);
            }}
          />
        )}
      </div>
      <DesignerStatus snapshot={snapshot} status={status} />
    </div>
  );
}
