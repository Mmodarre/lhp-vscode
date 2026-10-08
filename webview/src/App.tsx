import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ActionMutation, ActionNode, FlowgroupDetail, GraphEdge, HostMessage, InstanceRequest,
  OperationStatus, PreviewResult, ProjectSnapshot, ProjectSummary, SourceRef, WebviewRequest,
} from '../../src/shared/protocol'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import { request, subscribe } from './host'
import { actionGraph, documentVersions, pipelineGraph } from './model'
import { GraphPanel } from './components/GraphPanel'
import { ActionInspector } from './components/ActionInspector'
import { AddActionInspector } from './components/AddActionInspector'
import { FlowgroupInspector } from './components/FlowgroupInspector'
import { BronzeWizard } from './components/BronzeWizard'
import { InstanceWizard } from './components/InstanceWizard'

type Mode = 'pipeline' | 'flowgroup' | 'bronze' | 'template' | 'blueprint' | 'preview'
type Body = WebviewRequest extends infer T ? T extends { requestId: string } ? Omit<T, 'requestId'> : never : never

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>()
  const [trusted, setTrusted] = useState(true)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [protocolError, setProtocolError] = useState('')
  const [status, setStatus] = useState<OperationStatus>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string>()
  const [preview, setPreview] = useState<PreviewResult>()
  const [mode, setMode] = useState<Mode>('pipeline')
  const [pipelineId, setPipelineId] = useState('')
  const [flowgroupId, setFlowgroupId] = useState('')
  const [actionId, setActionId] = useState('')
  const [edgeId, setEdgeId] = useState('')
  const [showAddAction, setShowAddAction] = useState(false)
  const [showInspector, setShowInspector] = useState(true)

  useEffect(() => {
    const unsubscribe = subscribe((incoming: HostMessage) => {
      switch (incoming.type) {
        case 'bootstrap':
          setBootstrapped(true)
          if (incoming.protocolVersion !== PROTOCOL_VERSION) {
            setProtocolError(`This panel expects protocol ${PROTOCOL_VERSION}, but the extension host uses ${incoming.protocolVersion}. Reload the window.`)
            break
          }
          setProjects(incoming.projects)
          setTrusted(incoming.trusted)
          if (incoming.snapshot) setSnapshot(incoming.snapshot)
          break
        case 'snapshot':
          setSnapshot((current) => !current || current.context.project.id !== incoming.snapshot.context.project.id || incoming.snapshot.revision >= current.revision
            ? incoming.snapshot : current)
          break
        case 'status': setStatus(incoming.status); break
        case 'preview': setPreview(incoming.result); setMode('preview'); break
        case 'diagnostics':
          setSnapshot((current) => current ? { ...current, diagnostics: incoming.diagnostics } : current)
          break
        case 'result':
          setPending((current) => current === incoming.requestId ? undefined : current)
          if (incoming.success) { setMessage(incoming.message ?? 'Done.'); setError('') }
          else { setError(incoming.message ?? 'The operation failed.'); setMessage('') }
          break
        case 'error':
          setPending((current) => !incoming.requestId || current === incoming.requestId ? undefined : current)
          setError(`${incoming.message}${incoming.code === 'STALE_DOCUMENT' || incoming.code === 'STALE_CONTEXT' ? ' Refresh and review the latest YAML before retrying.' : ''}`)
          setMessage('')
          break
      }
    })
    request({ type: 'ready' })
    return unsubscribe
  }, [])

  const context = snapshot ? { projectId: snapshot.context.project.id, revision: snapshot.revision } : undefined
  const send = useCallback((body: Body, expectUpdate = false) => {
    setMessage(''); setError('')
    const id = request({ ...body, ...(context ? { context } : {}) } as Body)
    if (expectUpdate) setPending(id)
    return id
  }, [context])
  const open = useCallback((source: SourceRef) => { send({ type: 'openSource', source }) }, [send])
  const mutate = useCallback((mutation: ActionMutation) => {
    if (!snapshot || pending) return
    send({ type: 'mutate', projectId: snapshot.context.project.id, documentVersions: documentVersions(snapshot), mutation }, true)
  }, [snapshot, pending, send])

  const pipeline = snapshot?.pipelines.find((item) => item.name === pipelineId) ?? snapshot?.pipelines[0]
  const flowgroup = snapshot?.flowgroups.find((item) => item.id === flowgroupId)
    ?? snapshot?.flowgroups.find((item) => item.pipeline === pipeline?.name)
  const selectedAction = flowgroup?.actions.find((action) => action.id === actionId)
  const selectedEdge = flowgroup?.edges.find((edge) => edge.id === edgeId)
  const selectedSummary = pipeline?.flowgroups.find((item) => item.id === flowgroupId) ?? pipeline?.flowgroups[0]
  const graph = useMemo(() => {
    if (!snapshot) return undefined
    return mode === 'flowgroup' && flowgroup ? actionGraph(flowgroup) : pipeline ? pipelineGraph(snapshot, pipeline.name) : undefined
  }, [snapshot, mode, flowgroup, pipeline])
  const syntaxError = snapshot?.diagnostics.some((item) => item.layer === 'syntax' && item.severity === 'error') ?? false
  const canEdit = !!snapshot?.context.trusted && !!snapshot?.context.runtime.compatible && !snapshot.stale && !syntaxError && !pending && !status?.running
  const canUndo = !!snapshot?.context.trusted && !pending && !status?.running
  const dirtyCount = snapshot?.documents.filter((item) => item.dirty).length ?? 0
  const canGenerate = !!snapshot?.context.trusted && !!snapshot.context.runtime.compatible && !status?.running && !pending
  const previewStale = !!preview && !!snapshot && snapshot.documents.some((doc) => preview.documentVersions[doc.path] !== doc.version)
  const choosePipeline = (name: string) => { setPipelineId(name); setFlowgroupId(''); setActionId(''); setEdgeId(''); setMode('pipeline'); setShowAddAction(false) }
  const chooseFlowgroup = (id: string) => { setFlowgroupId(id); setActionId(''); setEdgeId(''); setMode('flowgroup'); setShowAddAction(false) }
  const chooseAction = (id: string) => {
    setActionId(id); setEdgeId(''); setShowAddAction(false); setShowInspector(true)
    const action = flowgroup?.actions.find((item) => item.id === id)
    if (action) open(action.source)
  }
  const selectProject = (id: string) => {
    setSnapshot(undefined); setPreview(undefined); setMode('pipeline'); setMessage(''); setError('')
    setPending(request({ type: 'selectProject', projectId: id }))
  }
  const createInstance = (values: InstanceRequest) => { send({ type: 'createInstance', values }, true) }

  if (protocolError) return <div className="empty"><h2>Extension protocol mismatch</h2><p>{protocolError}</p></div>
  if (!bootstrapped) return <div className="empty" role="status"><h2>Loading LHP workspace…</h2><p>Waiting for the extension host to identify this project.</p></div>
  if (!snapshot) return <div className="app"><header className="topbar"><div className="brand"><span className="brand-mark">LHP</span> Lakehouse Plumber</div></header>
    <div className="empty"><h2>{projects.length ? 'Choose an LHP project' : 'Start an LHP project'}</h2>
      <p>{projects.length ? 'Select a workspace project to inspect its pipelines and flowgroups.' : 'No project was found in this workspace. Initialize one in a trusted folder to begin.'}</p>
      {!trusted && <div className="notice warn">Trust this workspace before project setup or editing.</div>}
      {projects.map((project) => <button key={project.id} className="button secondary" onClick={() => selectProject(project.id)}>{project.name} · {project.rootLabel}</button>)}
      <div className="inspector-actions"><button className="button" onClick={() => send({ type: 'createProject' }, true)} disabled={!trusted || !!pending}>Initialize project</button>
        <button className="button secondary" onClick={() => send({ type: 'selectInterpreter' })}>Select Python interpreter</button></div>
      {status?.message && <p role="status">{status.message}</p>}{error && <div className="notice error" role="alert">{error}</div>}
    </div></div>

  const running = !!status?.running
  const projectId = snapshot.context.project.id
  const showingGraph = mode === 'pipeline' || mode === 'flowgroup'
  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">LHP</span><span>Lakehouse Plumber</span></div>
      <span className="topbar-meta" title={snapshot.context.project.rootLabel}>{snapshot.context.project.name} · {snapshot.context.project.rootLabel}</span>
      <span className="topbar-spacer" />
      {snapshot.stale && <span className="badge warn">Stale graph</span>}
      {dirtyCount > 0 && <span className="badge warn">{dirtyCount} unsaved</span>}
      <button className="button quiet small" onClick={() => setShowInspector(!showInspector)} aria-pressed={showInspector}>Inspector</button>
    </header>
    <div className="toolbar" role="toolbar" aria-label="Project commands">
      <div className="toolbar-group">
        <label className="sr-only" htmlFor="project-choice">Project</label>
        <select className="select" id="project-choice" style={{ width: 145 }} value={projectId} onChange={(event) => selectProject(event.target.value)}>
          {projects.length ? projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value={projectId}>{snapshot.context.project.name}</option>}
        </select>
        <label className="sr-only" htmlFor="environment-choice">Environment</label>
        <select className="select" id="environment-choice" style={{ width: 105 }} value={snapshot.context.environment}
          onChange={(event) => { setPreview(undefined); send({ type: 'selectEnvironment', environment: event.target.value }, true) }} disabled={running || !!pending}>
          {snapshot.context.environments.map((env) => <option key={env} value={env}>{env}</option>)}
        </select>
        <button className="button quiet small" onClick={() => send({ type: 'refresh' }, true)} disabled={running}>Refresh</button>
      </div>
      <span className="toolbar-spacer" />
      <div className="toolbar-group">
        <button className="button secondary small" onClick={() => send({ type: 'undo' }, true)} disabled={!canUndo}>Undo</button>
        <button className="button secondary small" onClick={() => send({ type: 'redo' }, true)} disabled={!canUndo}>Redo</button>
        <button className="button secondary small" onClick={() => send({ type: 'validate' }, true)} disabled={!snapshot.context.trusted || running || !!pending}>Validate</button>
        <button className="button secondary small" onClick={() => send({ type: 'preview' }, true)} disabled={!snapshot.context.trusted || running || !!pending}>Preview output</button>
        <button className="button small" onClick={() => send({ type: 'generate' }, true)} disabled={!canGenerate}>Generate full project…</button>
        {running && <button className="button danger small" onClick={() => send({ type: 'cancel' })}>Cancel</button>}
      </div>
    </div>
    {!snapshot.context.runtime.compatible && <div className="notice warn" role="alert">
      <p><strong>LHP runtime unavailable or incompatible.</strong> {snapshot.context.runtime.message ?? 'Choose a compatible LHP 0.9.3 interpreter.'}</p>
      <div className="inspector-actions"><button className="button secondary small" onClick={() => send({ type: 'selectInterpreter' })}>Choose interpreter</button>
        <button className="button secondary small" onClick={() => send({ type: 'setupEnvironment' }, true)}>Set up environment</button></div>
    </div>}
    {!snapshot.context.trusted && <div className="notice warn">Workspace trust is required before project edits, validation, or generation.</div>}
    {(snapshot.stale || syntaxError) && <div className="notice warn" role="status">This graph is based on the last valid project snapshot. Fix YAML errors or refresh before making graph edits. Native source files remain editable.</div>}
    {snapshot.notices.map((notice, index) => <div className="notice" key={`${index}-${notice}`}>{notice}</div>)}
    {message && <div className="notice" role="status">{message}</div>}{error && <div className="notice error" role="alert">{error}</div>}
    <div className={`body${showInspector ? ' with-inspector' : ''}`}>
      <nav className="sidebar" aria-label="Project structure">
        <h2 className="section-heading">Pipelines</h2>
        <ul className="tree">{snapshot.pipelines.map((item) => <li key={item.name}>
          <button className="tree-button" aria-current={mode === 'pipeline' && item.name === pipeline?.name ? 'page' : undefined}
            onClick={() => choosePipeline(item.name)}><span className="tree-icon" aria-hidden="true">▤</span><span className="label">{item.name}</span><span className="tree-count">{item.flowgroups.length}</span></button>
          <ul className="tree-nested">{item.flowgroups.map((group) => <li key={group.id}>
            <button className="tree-button" aria-current={mode === 'flowgroup' && group.id === flowgroup?.id ? 'page' : undefined}
              onClick={() => chooseFlowgroup(group.id)}><span className="tree-icon" aria-hidden="true">◇</span><span className="label">{group.name}</span></button>
          </li>)}</ul>
        </li>)}</ul>
        {snapshot.pipelines.length === 0 && <p className="section-note">No pipelines yet. Start with the files-to-bronze guide.</p>}
        <h2 className="section-heading">Create</h2>
        <div style={{ padding: '0 10px 12px', display: 'grid', gap: 5 }}>
          <button className="button secondary small" onClick={() => setMode('bronze')} disabled={!canEdit}>Files → bronze</button>
          <button className="button quiet small" onClick={() => setMode('template')}>Template instance</button>
          <button className="button quiet small" onClick={() => setMode('blueprint')}>Blueprint instance</button>
        </div>
        <h2 className="section-heading">Help</h2>
        <div style={{ padding: '0 10px 12px', display: 'grid', gap: 5 }}>
          <button className="button quiet small" onClick={() => send({ type: 'databricks' })}>Databricks handoff</button>
          <button className="button quiet small" onClick={() => send({ type: 'selectInterpreter' })}>Python interpreter</button>
        </div>
      </nav>
      <main className="main">
        {showingGraph && <><div className="pane-title"><h2>{mode === 'flowgroup' ? `${flowgroup?.name ?? 'Flowgroup'} · actions` : `${pipeline?.name ?? 'Pipeline'} · flowgroups`}</h2>
          <span className="subtitle">{mode === 'flowgroup' ? 'Action dependencies' : 'Flowgroup dependencies'}</span></div>
          {mode === 'flowgroup' && flowgroup && <div className="toolbar">
            <button className="button quiet small" onClick={() => choosePipeline(flowgroup.pipeline)}>← Pipeline graph</button>
            <button className="button secondary small" onClick={() => open(flowgroup.source)}>Open YAML</button>
            <span className="toolbar-spacer" />
            <button className="button small" onClick={() => { setShowAddAction(true); setActionId(''); setEdgeId(''); setShowInspector(true) }} disabled={!canEdit || !flowgroup.editable}>+ Add action</button>
          </div>}
          {graph ? <GraphPanel graph={graph} selectedId={mode === 'flowgroup' ? actionId : selectedSummary?.id}
            onSelect={(id) => mode === 'flowgroup' ? chooseAction(id) : chooseFlowgroup(id)}
            onEdgeSelect={(id) => { setEdgeId(id); setActionId(''); setShowInspector(true) }}
            emptyTitle={mode === 'flowgroup' ? 'No actions in this flowgroup' : 'No flowgroups in this pipeline'}
            emptyDescription={mode === 'flowgroup' ? 'Add the first action or open the YAML source.' : 'Create a flowgroup with the files-to-bronze guide or native YAML.'} />
            : <div className="empty"><h2>No graph available</h2><p>Choose a pipeline or create a flowgroup.</p></div>}
        </>}
        {mode === 'bronze' && <BronzeWizard pipelines={snapshot.pipelines.map((item) => item.name)} busy={!!pending}
          onCancel={() => setMode('pipeline')} onCreate={(values) => send({ type: 'createBronze', values }, true)} />}
        {(mode === 'template' || mode === 'blueprint') && <InstanceWizard kind={mode} catalog={snapshot.catalog}
          pipelines={snapshot.pipelines.map((item) => item.name)} busy={!!pending}
          onCancel={() => setMode('pipeline')} onCreate={createInstance} onOpen={open} />}
        {mode === 'preview' && <div className="wizard" style={{ margin: 0, width: '100%' }}><h1>Generated output preview</h1>
          {!preview ? <p className="lead">Preview is not available. Run Preview output to inspect proposed files.</p> : <>
            <p className="lead">{preview.parity === 'full' ? 'Full output preview' : 'Source-only preview: this does not include every final generated artifact.'} Select a file to open its read-only preview in VS Code.</p>
            {previewStale && <div className="notice warn" role="status">Project documents changed after this preview. Run Preview output again before relying on these files.</div>}
            {preview.notices.map((item, index) => <div className="notice warn" key={index}>{item}</div>)}
            {preview.files.length === 0 && <div className="notice">No preview files were returned.</div>}
            {preview.files.map((file) => <button className="link-button" key={file.path} onClick={() => send({ type: 'showPreviewFile', path: file.path })}>{file.path} <span className="badge">{file.kind}</span></button>)}
          </>}
          <button className="button secondary small" onClick={() => setMode('pipeline')}>Back to graph</button></div>}
      </main>
      {showInspector && <aside className="inspector" aria-label="Selection inspector">
        {mode === 'flowgroup' && flowgroup && showAddAction ? <AddActionInspector flowgroupId={flowgroup.id} catalog={snapshot.catalog}
          canEdit={canEdit && flowgroup.editable} onCancel={() => setShowAddAction(false)} onMutate={mutate} />
        : mode === 'flowgroup' && flowgroup && selectedAction ? <ActionInspector action={selectedAction} detail={flowgroup} catalog={snapshot.catalog}
          canEditGraph={canEdit && flowgroup.editable} onOpen={open} onMutate={mutate} />
        : mode === 'flowgroup' && flowgroup && selectedEdge ? <EdgeInspector edge={selectedEdge} detail={flowgroup} canEdit={canEdit} onMutate={mutate} />
        : mode === 'flowgroup' && flowgroup ? <FlowgroupInspector detail={flowgroup} catalog={snapshot.catalog}
          canEditGraph={canEdit} onOpen={open} onMutate={mutate} onShowActions={() => setActionId(flowgroup.actions[0]?.id ?? '')} />
        : mode === 'pipeline' && selectedSummary ? <div className="inspector-body"><h2 className="inspector-title">{selectedSummary.name}</h2>
          <p className="inspector-subtitle">{selectedSummary.actionCount} actions · {selectedSummary.origin.kind}</p>
          <div className="inspector-actions"><button className="button small" onClick={() => chooseFlowgroup(selectedSummary.id)}>Open action graph</button>
            <button className="button secondary small" onClick={() => open(selectedSummary.source)}>Open source YAML</button></div>
          {selectedSummary.origin.definition && <button className="link-button" onClick={() => open(selectedSummary.origin.definition!)}>Open {selectedSummary.origin.kind} definition</button>}
          {selectedSummary.origin.instance && <button className="link-button" onClick={() => open(selectedSummary.origin.instance!)}>Open instance YAML</button>}
        </div> : <div className="inspector-body"><h2 className="inspector-title">Project</h2><p className="field-help">Choose a pipeline, flowgroup, or action to inspect its source and edit options.</p></div>}
      </aside>}
    </div>
    <footer className="statusbar" role="status">
      <span>{snapshot.context.environment} environment</span><span>·</span><span>{snapshot.context.runtime.lhpVersion ?? 'LHP runtime unavailable'}</span>
      <span>·</span><span>{snapshot.diagnostics.filter((item) => item.severity === 'error').length} errors, {snapshot.diagnostics.filter((item) => item.severity === 'warning').length} warnings</span>
      <span className="spacer" />{status?.message && <span>{status.message}</span>}
      <span>Revision {snapshot.revision}</span>
    </footer>
  </div>
}

function EdgeInspector({ edge, detail, canEdit, onMutate }: {
  edge: GraphEdge; detail: FlowgroupDetail; canEdit: boolean; onMutate: (mutation: ActionMutation) => void
}) {
  const from = detail.actions.find((item: ActionNode) => item.id === edge.source)?.name ?? edge.source
  const to = detail.actions.find((item: ActionNode) => item.id === edge.target)?.name ?? edge.target
  return <div className="inspector-body"><h2 className="inspector-title">Action dependency</h2>
    <p className="inspector-subtitle">{from} → {to}</p><p className="mono">{edge.dataset || 'Unlabelled dependency'}</p>
    {edge.reason && <div className="notice warn">{edge.reason}</div>}
    <button className="button danger small" disabled={!canEdit || !edge.editable}
      onClick={() => onMutate({ kind: 'disconnect', sourceId: edge.source, targetId: edge.target, dataset: edge.dataset })}>Disconnect</button>
  </div>
}
