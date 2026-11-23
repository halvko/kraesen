import { lazy, Suspense, useState } from 'react'
import { newId } from '../persist'
import { useStore } from '../store'
import { type Stock, STOCK_LABEL, type Ware, zeroMacros } from '../types'
import { type FoodDraft, FoodEditor } from './FoodEditor'
import { StaplesCard } from './StaplesCard'
import { FoodRow } from './FoodRow'

type Mode = { kind: 'list' } | { kind: 'scan' } | { kind: 'edit'; id?: string; draft: FoodDraft; banner?: string; title: string }

const GROUPS: { stock: Stock; empty: string }[] = [
  { stock: 'home', empty: 'Nothing at home yet. Add home-grown produce or scan what is in the fridge.' },
  { stock: 'freezer', empty: '' },
  { stock: 'shop', empty: '' },
  { stock: 'off', empty: '' },
]

// The barcode reader and Claude SDK are only downloaded when scanning.
const Scanner = lazy(() => import('./Scanner').then((m) => ({ default: m.Scanner })))

export function KitchenPage() {
  const { state, update } = useStore()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [filter, setFilter] = useState('')

  const save = (id: string | undefined, d: FoodDraft) => {
    update((s) => {
      if (id) return { ...s, wares: s.wares.map((w) => (w.id === id ? { ...w, ...d } : w)) }
      return { ...s, wares: [...s.wares, { ...d, id: newId(), createdAt: Date.now() }] }
    })
    setMode({ kind: 'list' })
  }

  if (mode.kind === 'scan') {
    return (
      <div className="page">
        <Suspense fallback={<p className="hint">Loading scanner…</p>}>
          <Scanner
            onCancel={() => setMode({ kind: 'list' })}
            onResult={(draft, banner) => setMode({ kind: 'edit', draft, banner, title: 'Confirm food' })}
          />
        </Suspense>
      </div>
    )
  }
  if (mode.kind === 'edit') {
    const { id } = mode
    const name = mode.draft.name
    return (
      <div className="page">
        <FoodEditor
          title={mode.title}
          initial={mode.draft}
          banner={mode.banner}
          onCancel={() => setMode({ kind: 'list' })}
          onSave={(d) => save(id, d)}
          onDelete={
            id
              ? () => {
                  if (!confirm(`Delete ${name}? Its macros are gone for good. To keep it for later, set it to Not now instead.`)) return
                  update((s) => ({ ...s, wares: s.wares.filter((x) => x.id !== id) }))
                  setMode({ kind: 'list' })
                }
              : undefined
          }
        />
      </div>
    )
  }

  const q = filter.trim().toLowerCase()
  const shown = state.wares.filter((w) => !q || w.name.toLowerCase().includes(q) || w.brand?.toLowerCase().includes(q))
  const row = (w: Ware) => (
    <FoodRow key={w.id} food={w} onOpen={() => setMode({ kind: 'edit', id: w.id, draft: { ...w }, title: 'Edit food' })} />
  )

  return (
    <div className="page">
      <div className="row">
        <button
          type="button"
          onClick={() =>
            setMode({
              kind: 'edit',
              title: 'Add food',
              draft: { name: '', source: 'custom', per100: zeroMacros(), stock: 'home' },
              banner: 'Type the macros per 100 g, e.g. from the packaging or a quick web search.',
            })
          }
        >
          + Add food
        </button>
        <button type="button" className="secondary" onClick={() => setMode({ kind: 'scan' })}>
          Scan barcode
        </button>
      </div>
      {state.wares.length > 6 && (
        <input className="filter" placeholder="Search foods" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search foods" />
      )}
      {GROUPS.map((g) => {
        const items = shown.filter((w) => w.stock === g.stock).sort((a, b) => a.name.localeCompare(b.name))
        if (items.length === 0 && !g.empty) return null
        const title = (
          <h2>
            {STOCK_LABEL[g.stock]} <span className="count">{items.length}</span>
          </h2>
        )
        if (g.stock === 'off') {
          return (
            <details key={g.stock} className="card group-off" open={!!q || undefined}>
              <summary>{title}</summary>
              <p className="hint">Kept for later. Claude never sees these.</p>
              <ul className="ware-list">{items.map(row)}</ul>
            </details>
          )
        }
        return (
          <section key={g.stock} className="card">
            {title}
            {items.length === 0 && <p className="hint">{g.empty}</p>}
            <ul className="ware-list">{items.map(row)}</ul>
          </section>
        )
      })}
      <StaplesCard />
    </div>
  )
}
