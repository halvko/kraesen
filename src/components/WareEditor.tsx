import { useState } from 'react'
import { LIST_LABEL, type Macros, type Ware, type WareList, type WareStatus } from '../types'
import { MacroInputs } from './MacroInputs'

export interface WareDraft {
  name: string
  brand?: string
  barcode?: string
  source: Ware['source']
  per100: Macros
  list: WareList
  status: WareStatus
  notes?: string
}

interface Props {
  initial: WareDraft
  title: string
  banner?: string
  onSave: (d: WareDraft) => void
  onCancel: () => void
}

export function WareEditor({ initial, title, banner, onSave, onCancel }: Props) {
  const [d, setD] = useState<WareDraft>(initial)
  const valid = d.name.trim().length > 0
  return (
    <div className="card editor">
      <h2>{title}</h2>
      {banner && <p className="banner">{banner}</p>}
      <label>
        <span>Name</span>
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Garden tomatoes" autoFocus />
      </label>
      {(d.brand !== undefined || d.source !== 'custom') && (
        <label>
          <span>Brand</span>
          <input value={d.brand ?? ''} onChange={(e) => setD({ ...d, brand: e.target.value })} />
        </label>
      )}
      <h3>Per 100 g</h3>
      <MacroInputs idPrefix="ware" value={d.per100} onChange={(per100) => setD({ ...d, per100 })} />
      <div className="two-col">
        <label>
          <span>List</span>
          <select value={d.list} onChange={(e) => setD({ ...d, list: e.target.value as WareList })}>
            {Object.entries(LIST_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Availability</span>
          <select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as WareStatus })}>
            <option value="available">Available</option>
            <option value="frozen">Frozen</option>
            <option value="out">Out</option>
          </select>
        </label>
      </div>
      <label>
        <span>Notes for the meal planner (optional)</span>
        <input value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="e.g. very ripe, use soon" />
      </label>
      <div className="row">
        <button type="button" disabled={!valid} onClick={() => onSave({ ...d, name: d.name.trim(), notes: d.notes?.trim() || undefined })}>
          Save ware
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
