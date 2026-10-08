import { useMemo, useState, type FormEvent } from 'react'
import type { EditorCatalog, InstanceRequest, JsonObject, SourceRef } from '../../../src/shared/protocol'
import { fieldValue } from '../model'
import { Fields } from './Fields'

export function InstanceWizard({ kind, catalog, pipelines, busy, onCancel, onCreate, onOpen }: {
  kind: 'template' | 'blueprint'; catalog: EditorCatalog; pipelines: string[]; busy: boolean
  onCancel: () => void; onCreate: (request: InstanceRequest) => void; onOpen: (source: SourceRef) => void
}) {
  const definitions = kind === 'template' ? catalog.templates : catalog.blueprints
  const [definition, setDefinition] = useState(definitions[0]?.name ?? '')
  const [name, setName] = useState('')
  const [pipeline, setPipeline] = useState(pipelines[0] ?? '')
  const [targetPath, setTargetPath] = useState('')
  const [parameters, setParameters] = useState<JsonObject>({})
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedDraft, setAdvancedDraft] = useState('{}')
  const [advancedError, setAdvancedError] = useState('')
  const selected = useMemo(() => definitions.find((item) => item.name === definition), [definitions, definition])
  const invalidPath = targetPath.startsWith('/') || targetPath.includes('..') || !/\.ya?ml$/i.test(targetPath)
  const requiredMissing = selected?.fields.some((field) => field.required && (fieldValue(parameters, field.name) === undefined || fieldValue(parameters, field.name) === '')) ?? false
  const canSubmit = !!selected && !!name.trim() && !!pipeline.trim() && !invalidPath && !requiredMissing && !advancedError && !Object.values(invalid).some(Boolean)
  const changeParameters = (value: JsonObject) => { setParameters(value); setAdvancedDraft(JSON.stringify(value, null, 2)) }
  const changeAdvanced = (value: string) => {
    setAdvancedDraft(value)
    try {
      const parsed: unknown = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object')
      setParameters(parsed as JsonObject)
      setAdvancedError('')
    } catch { setAdvancedError('Enter a JSON object before creating this instance.') }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || busy) return
    onCreate({ kind, definition, name: name.trim(), pipeline: pipeline.trim(), targetPath: targetPath.trim(), parameters })
  }
  return <form className="wizard" onSubmit={submit} aria-label={`Create ${kind} instance`}>
    <h1>New {kind} instance</h1>
    <p className="lead">Choose a reusable definition and fill its parameters. The new instance remains editable in native YAML; inherited actions link back to their definition.</p>
    {definitions.length === 0 ? <div className="notice warn">No {kind} definitions were found. Add one in your project or open its YAML directly.</div> : <>
      <div className="field"><label className="field-label" htmlFor="instance-definition">{kind === 'template' ? 'Template' : 'Blueprint'} <span className="required">*</span></label>
        <select className="select" id="instance-definition" value={definition} onChange={(event) => { setDefinition(event.target.value); changeParameters({}); setInvalid({}); setAdvancedError('') }}>
          {definitions.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>{selected?.description && <span className="field-help">{selected.description}</span>}
        {selected && <button className="link-button" type="button" onClick={() => onOpen(selected.source)}>Open definition source</button>}
      </div>
      <div className="wizard-grid">
        <div className="field"><label className="field-label" htmlFor="instance-name">Instance name <span className="required">*</span></label>
          <input id="instance-name" className="input" value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <div className="field"><label className="field-label" htmlFor="instance-pipeline">Pipeline <span className="required">*</span></label>
          <input id="instance-pipeline" className="input" value={pipeline} onChange={(event) => setPipeline(event.target.value)} list="instance-pipelines" required />
          <datalist id="instance-pipelines">{pipelines.map((value) => <option value={value} key={value} />)}</datalist></div>
      </div>
      <div className="field"><label className="field-label" htmlFor="instance-target">New instance YAML path <span className="required">*</span></label>
        <input id="instance-target" className="input mono" value={targetPath} placeholder="pipelines/bronze/orders.yaml" onChange={(event) => setTargetPath(event.target.value)} required aria-invalid={!!targetPath && invalidPath} />
        <span className="field-help">Project-relative .yaml or .yml path. Existing files will not be replaced.</span>
        {!!targetPath && invalidPath && <span className="field-error" role="alert">Use a project-relative YAML path without “..”.</span>}</div>
      {selected && <section className="inspector-group"><h2 style={{ fontSize: 13 }}>Definition parameters</h2>
        {selected.fields.length ? <Fields fields={selected.fields} value={parameters} onChange={changeParameters}
          onValidChange={(field, valid) => setInvalid((current) => ({ ...current, [field]: !valid }))} />
          : <p className="field-help">This definition has no declared parameters. Review its source before creating an instance.</p>}
        <button type="button" className="button quiet small" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Hide' : 'Show'} advanced parameters</button>
        {showAdvanced && <div className="field"><label className="field-label" htmlFor="instance-advanced">Complete parameters (JSON)</label>
          <textarea id="instance-advanced" className="textarea mono" value={advancedDraft} onChange={(event) => changeAdvanced(event.target.value)} aria-invalid={!!advancedError} />
          {advancedError && <span className="field-error" role="alert">{advancedError}</span>}
          <span className="field-help">Use this for parameters not exposed by the guided form. The created YAML remains the source of truth.</span></div>}
      </section>}
      <div className="wizard-actions"><button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button" disabled={!canSubmit || busy}>{busy ? 'Creating…' : `Create ${kind} instance`}</button></div>
    </>}
  </form>
}
