import { useState, type FormEvent } from 'react'
import type { BronzeRequest } from '../../../src/shared/protocol'

const FORMATS = ['csv', 'json', 'parquet', 'avro', 'orc', 'text']

export function BronzeWizard({ pipelines, busy, onCancel, onCreate }: {
  pipelines: string[]
  busy: boolean
  onCancel: () => void
  onCreate: (values: BronzeRequest) => void
}) {
  const [name, setName] = useState('')
  const [pipeline, setPipeline] = useState(() => pipelines[0] ?? 'bronze_load')
  const [sourcePath, setSourcePath] = useState('')
  const [format, setFormat] = useState('csv')
  const [target, setTarget] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const targetQualified = target.split('.').length === 3 && target.split('.').every((part) => !!part.trim())
  const valid = !!name.trim() && !!pipeline.trim() && !!sourcePath.trim() && targetQualified
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!valid || busy) return
    onCreate({ name: name.trim(), pipeline: pipeline.trim(), sourcePath: sourcePath.trim(), format, target: target.trim() })
  }
  return <form className="wizard" onSubmit={submit} aria-label="Files to bronze guide">
    <h1>Ingest files into bronze</h1>
    <p className="lead">Create a flowgroup with a file-streaming load action and a bronze streaming-table write action. Review the generated YAML and validate before generating project output.</p>
    <div className="wizard-grid">
      <div className="field"><label className="field-label" htmlFor="bronze-name">Flowgroup name <span className="required">*</span></label>
        <input className="input" id="bronze-name" value={name} placeholder="orders_bronze" onChange={(event) => setName(event.target.value)} required />
        <span className="field-help">Use a unique, descriptive name for this ingestion.</span></div>
      <div className="field"><label className="field-label" htmlFor="bronze-pipeline">Pipeline <span className="required">*</span></label>
        <input className="input" id="bronze-pipeline" value={pipeline} list="pipeline-options" onChange={(event) => setPipeline(event.target.value)} required />
        <datalist id="pipeline-options">{pipelines.map((value) => <option key={value} value={value} />)}</datalist>
        <span className="field-help">Choose an existing pipeline or name a new bronze pipeline.</span></div>
      <div className="field"><label className="field-label" htmlFor="bronze-path">Landing files path <span className="required">*</span></label>
        <input className="input mono" id="bronze-path" value={sourcePath} placeholder="${'{landing_volume}'}/orders/" onChange={(event) => setSourcePath(event.target.value)} required />
        <span className="field-help">Cloud or volume path read by Auto Loader. This is data, not an editable project source file.</span></div>
      <div className="field"><label className="field-label" htmlFor="bronze-format">File format</label>
        <select className="select" id="bronze-format" value={format} onChange={(event) => setFormat(event.target.value)}>
          {FORMATS.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select><span className="field-help">Choose the format of incoming files.</span></div>
      <div className="field"><label className="field-label" htmlFor="bronze-target">Bronze table (catalog.schema.table) <span className="required">*</span></label>
        <input className="input mono" id="bronze-target" value={target} placeholder="main.bronze.orders" onChange={(event) => setTarget(event.target.value)} aria-invalid={!!target && !targetQualified} required />
        <span className="field-help">Use a fully qualified target. Configured environment variables can supply catalog and schema.</span>
        {!!target && !targetQualified && <span className="field-error" role="alert">Enter catalog.schema.table.</span>}</div>
    </div>
    {submitted && !valid && <div className="notice error" role="alert">Complete the required fields before creating the flowgroup.</div>}
    <div className="wizard-actions"><button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
      <button className="button" type="submit" disabled={busy || !valid}>{busy ? 'Creating…' : 'Create flowgroup'}</button></div>
  </form>
}
