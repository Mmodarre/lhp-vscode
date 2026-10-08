import { useMemo, useState, type FormEvent } from 'react'
import type { ActionMutation, EditorCatalog, JsonObject } from '../../../src/shared/protocol'
import { fieldValue } from '../model'
import { Fields } from './Fields'

export function AddActionInspector({ flowgroupId, catalog, canEdit, onCancel, onMutate }: {
  flowgroupId: string; catalog: EditorCatalog; canEdit: boolean
  onCancel: () => void; onMutate: (mutation: ActionMutation) => void
}) {
  const [selected, setSelected] = useState(0)
  const definition = catalog.actions[selected]
  const [values, setValues] = useState<JsonObject>(() => definition ? structuredClone(definition.defaults) : {})
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const requiredMissing = definition?.fields.some((field) => field.required && field.name !== 'name' && field.name !== 'type' &&
    [undefined, null, ''].includes(fieldValue(values, field.name) as string | null | undefined)) ?? false
  const canSubmit = canEdit && !!definition && !!name.trim() && !requiredMissing && !Object.values(invalid).some(Boolean)
  const groups = useMemo(() => Array.from(new Set(catalog.actions.map((item) => item.type))), [catalog.actions])
  const switchDefinition = (index: number) => {
    setSelected(index)
    setValues(structuredClone(catalog.actions[index]?.defaults ?? {}))
    setInvalid({})
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !definition) return
    onMutate({ kind: 'add', flowgroupId, action: { ...values, name: name.trim(), type: definition.type } })
  }
  return <div className="inspector-body">
    <h2 className="inspector-title">Add action</h2>
    <p className="inspector-subtitle">Choose a supported action type, then set its required fields.</p>
    {!canEdit && <div className="notice warn">Graph edits are paused for this source.</div>}
    {catalog.actions.length === 0 ? <div className="notice warn">No action definitions are available from the selected LHP runtime. Open the flowgroup YAML to edit it.</div> : <form onSubmit={submit}>
      <div className="field"><label className="field-label" htmlFor="action-kind">Action type</label>
        <select id="action-kind" className="select" value={selected} onChange={(event) => switchDefinition(Number(event.target.value))}>
          {groups.map((group) => <optgroup key={group} label={group}>
            {catalog.actions.map((item, index) => item.type === group && <option key={`${item.type}-${item.subtype ?? index}`} value={index}>{item.label}</option>)}
          </optgroup>)}
        </select></div>
      {definition?.description && <p className="field-help">{definition.description}</p>}
      <div className="field"><label className="field-label" htmlFor="new-action-name">Action name <span className="required">*</span></label>
        <input id="new-action-name" className="input" value={name} onChange={(event) => setName(event.target.value)} required placeholder="load_orders" /></div>
      {definition && <Fields fields={definition.fields.filter((field) => field.name !== 'name' && field.name !== 'type')}
        value={values} onChange={setValues} onValidChange={(field, valid) => setInvalid((current) => ({ ...current, [field]: !valid }))} />}
      <div className="inspector-actions"><button className="button small" type="submit" disabled={!canSubmit}>Add to YAML</button>
        <button className="button secondary small" type="button" onClick={onCancel}>Cancel</button></div>
    </form>}
  </div>
}
