import { useState } from 'react'
import { type Macros, sameMacros, type Stock, STOCK_HINT, STOCK_LABEL, STOCKS, type Ware } from '../types'
import { MacroInputs } from './MacroInputs'

export interface FoodDraft {
  name: string
  brand?: string
  barcode?: string
  source: Ware['source']
  per100: Macros
  stock: Stock
  notes?: string
}

interface Props {
  initial: FoodDraft
  /** The food is already saved as `initial`, so Save stays off until something changes. */
  saved?: boolean
  title: string
  banner?: string
  onSave: (d: FoodDraft) => void
  onCancel: () => void
  /** Shown only when editing a saved food. */
  onDelete?: () => void
}

export function FoodEditor({ initial, saved, title, banner, onSave, onCancel, onDelete }: Props) {
  const [d, setD] = useState<FoodDraft>(initial)
  const clean = (f: FoodDraft): FoodDraft => ({ ...f, name: f.name.trim(), notes: f.notes?.trim() || undefined })
  const valid = d.name.trim().length > 0
  const changed =
    !saved ||
    clean(d).name !== initial.name ||
    (d.brand ?? '') !== (initial.brand ?? '') ||
    !sameMacros(d.per100, initial.per100) ||
    d.stock !== initial.stock ||
    clean(d).notes !== (initial.notes || undefined)
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
      <MacroInputs idPrefix="food" value={d.per100} onChange={(per100) => setD({ ...d, per100 })} />
      <fieldset className="stock-options">
        <legend>Where is it?</legend>
        {STOCKS.map((s) => (
          <label key={s} className={d.stock === s ? 'stock-option on' : 'stock-option'}>
            <input type="radio" name="stock" value={s} checked={d.stock === s} onChange={() => setD({ ...d, stock: s })} />
            <span>
              <strong>{STOCK_LABEL[s]}</strong>
              <small>{STOCK_HINT[s]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        <span>Notes for Claude (optional)</span>
        <input value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="e.g. very ripe, use soon" />
      </label>
      <div className="row">
        <button type="button" disabled={!valid || !changed} onClick={() => onSave(clean(d))}>
          Save food
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {onDelete && (
        <button type="button" className="secondary danger delete-food" onClick={onDelete}>
          Delete this food
        </button>
      )}
    </div>
  )
}
