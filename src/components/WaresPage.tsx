import { lazy, Suspense, useState } from 'react'
import { newId } from '../persist'
import { useStore } from '../store'
import { LIST_LABEL, type Ware, type WareList, type WareStatus, zeroMacros } from '../types'
import { type WareDraft, WareEditor } from './WareEditor'

type Mode = { kind: 'list' } | { kind: 'scan' } | { kind: 'edit'; id?: string; draft: WareDraft; banner?: string; title: string }

const SECTIONS: { list: WareList; title: string; empty: string }[] = [
  { list: 'have', title: 'I want to use', empty: 'Nothing yet. Add home-grown produce or scan what is in the fridge.' },
  { list: 'buy', title: "I'm willing to buy", empty: 'Add wares you would happily pick up at the shop.' },
  { list: 'neither', title: 'On neither list', empty: '' },
]

// The barcode reader and Claude SDK are only downloaded when scanning.
const Scanner = lazy(() => import('./Scanner').then((m) => ({ default: m.Scanner })))

const STATUS_LABEL: Record<WareStatus, string> = { available: 'Available', frozen: 'Frozen', out: 'Out' }

export function WaresPage() {
  const { state, update } = useStore()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [filter, setFilter] = useState('')

  const patch = (id: string, p: Partial<Ware>) => update((s) => ({ ...s, wares: s.wares.map((w) => (w.id === id ? { ...w, ...p } : w)) }))

  const save = (id: string | undefined, d: WareDraft) => {
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
            onResult={(draft, banner) => setMode({ kind: 'edit', draft, banner, title: 'Confirm ware' })}
          />
        </Suspense>
      </div>
    )
  }
  if (mode.kind === 'edit') {
    return (
      <div className="page">
        <WareEditor
          title={mode.title}
          initial={mode.draft}
          banner={mode.banner}
          onCancel={() => setMode({ kind: 'list' })}
          onSave={(d) => save(mode.id, d)}
        />
      </div>
    )
  }

  const q = filter.trim().toLowerCase()
  const shown = state.wares.filter((w) => !q || w.name.toLowerCase().includes(q) || w.brand?.toLowerCase().includes(q))

  const row = (w: Ware) => (
    <li key={w.id} className={`ware status-${w.status}`}>
      <button
        type="button"
        className="ware-main"
        onClick={() => setMode({ kind: 'edit', id: w.id, draft: { ...w }, title: 'Edit ware' })}
      >
        <span className="ware-name">
          {w.name}
          {w.brand ? <small> · {w.brand}</small> : null}
        </span>
        <span className="ware-macros">
          P {w.per100.protein} · C {w.per100.carbs} · F {w.per100.fat} · {w.per100.kcal} kcal
        </span>
      </button>
      <div className="ware-actions">
        <select
          aria-label={`Availability of ${w.name}`}
          value={w.status}
          onChange={(e) => patch(w.id, { status: e.target.value as WareStatus })}
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label={`List for ${w.name}`} value={w.list} onChange={(e) => patch(w.id, { list: e.target.value as WareList })}>
          {Object.entries(LIST_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon"
          aria-label={`Delete ${w.name}`}
          onClick={() => confirm(`Delete ${w.name}?`) && update((s) => ({ ...s, wares: s.wares.filter((x) => x.id !== w.id) }))}
        >
          ✕
        </button>
      </div>
    </li>
  )

  return (
    <div className="page">
      <div className="row">
        <button
          type="button"
          onClick={() =>
            setMode({
              kind: 'edit',
              title: 'Add ware',
              draft: { name: '', source: 'custom', per100: zeroMacros(), list: 'have', status: 'available' },
              banner: 'Type the macros per 100 g, e.g. from the packaging or a quick web search.',
            })
          }
        >
          + Add ware
        </button>
        <button type="button" className="secondary" onClick={() => setMode({ kind: 'scan' })}>
          Scan barcode
        </button>
      </div>
      {state.wares.length > 6 && (
        <input className="filter" placeholder="Filter wares" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter wares" />
      )}
      {SECTIONS.map((sec) => {
        const items = shown.filter((w) => w.list === sec.list).sort((a, b) => a.name.localeCompare(b.name))
        if (sec.list === 'neither' && items.length === 0) return null
        const current = items.filter((w) => w.status !== 'out')
        const out = items.filter((w) => w.status === 'out')
        return (
          <section key={sec.list} className="card">
            <h2>
              {sec.title} <span className="count">{items.length}</span>
            </h2>
            {items.length === 0 && <p className="hint">{sec.empty}</p>}
            <ul className="ware-list">{current.map(row)}</ul>
            {out.length > 0 && (
              <>
                <h3 className="out-heading">Out right now</h3>
                <ul className="ware-list">{out.map(row)}</ul>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}
