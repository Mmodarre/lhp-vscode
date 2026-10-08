import { useEffect, useState } from 'react'
import type { FieldDefinition, JsonObject, JsonValue } from '../../../src/shared/protocol'
import { fieldValue, setFieldValue } from '../model'

function display(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function JsonField({ id, label, value, emptyValue, onChange, onValidChange }: {
  id: string; label: string; value: JsonValue | undefined; emptyValue: JsonValue
  onChange: (value: JsonValue) => void
  onValidChange: (valid: boolean) => void
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value ?? emptyValue, null, 2))
  const [error, setError] = useState('')
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(draft)) === JSON.stringify(value ?? emptyValue)) return
    } catch { /* Keep the invalid local text until the parent value really changes. */ }
    setDraft(JSON.stringify(value ?? emptyValue, null, 2))
  }, [value])
  const change = (next: string) => {
    setDraft(next)
    try {
      const parsed = JSON.parse(next) as JsonValue
      onChange(parsed)
      setError('')
      onValidChange(true)
    } catch {
      setError('Enter valid JSON before saving.')
      onValidChange(false)
    }
  }
  return <>
    <textarea id={id} className="textarea mono" value={draft} aria-label={label}
      aria-invalid={!!error} onChange={(event) => change(event.target.value)} />
    {error && <span className="field-error" role="alert">{error}</span>}
  </>
}

export function Fields({ fields, value, onChange, onValidChange }: {
  fields: FieldDefinition[]
  value: JsonObject
  onChange: (value: JsonObject) => void
  onValidChange?: (name: string, valid: boolean) => void
}) {
  return <div className="form-stack">
    {fields.map((field) => {
      const id = `field-${field.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      const current = fieldValue(value, field.name)
      const write = (next: JsonValue) => onChange(setFieldValue(value, field.name, next))
      return <div className="field" key={field.name}>
        <label className="field-label" htmlFor={id}>{field.label}{field.required && <span className="required" aria-label="required">*</span>}</label>
        {field.description && <span className="field-help" id={`${id}-help`}>{field.description}</span>}
        {field.choices && field.choices.length > 0 ? <select id={id} className="select" value={current === undefined ? '' : JSON.stringify(current)}
          aria-describedby={field.description ? `${id}-help` : undefined}
          onChange={(event) => write(JSON.parse(event.target.value) as JsonValue)}>
          {current === undefined && <option value="" disabled>Select {field.label}</option>}
          {field.choices.map((choice) => <option key={JSON.stringify(choice)} value={JSON.stringify(choice)}>{display(choice)}</option>)}
        </select> : field.type === 'boolean' ? <select id={id} className="select" value={current === undefined ? '' : String(current)}
          onChange={(event) => write(event.target.value === 'true')}>
          <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
        </select> : field.type === 'object' || field.type === 'array' ? <JsonField id={id} label={field.label} emptyValue={field.type === 'array' ? [] : {}}
          value={current} onChange={write} onValidChange={(valid) => onValidChange?.(field.name, valid)} />
        : <input id={id} className="input" type={field.type === 'number' ? 'number' : 'text'}
          value={current === undefined || current === null ? '' : String(current)}
          placeholder={field.default === undefined ? undefined : display(field.default)}
          aria-describedby={field.description ? `${id}-help` : undefined}
          onChange={(event) => write(field.type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)} />}
      </div>
    })}
  </div>
}
