import { MACRO_KEYS, MACRO_LABELS, MACRO_UNITS, type Macros } from '../types'

interface Props {
  value: Macros
  onChange: (m: Macros) => void
  suffix?: string
  idPrefix: string
}

export function MacroInputs({ value, onChange, suffix, idPrefix }: Props) {
  return (
    <div className="macro-grid">
      {MACRO_KEYS.map((k) => (
        <label key={k} htmlFor={`${idPrefix}-${k}`}>
          <span>
            {MACRO_LABELS[k]} ({MACRO_UNITS[k]}
            {suffix ? ` ${suffix}` : ''})
          </span>
          <input
            id={`${idPrefix}-${k}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={Number.isFinite(value[k]) ? value[k] : ''}
            onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  )
}

export function MacroSummary({ macros, target }: { macros: Macros; target?: Macros }) {
  return (
    <div className="macro-summary">
      {MACRO_KEYS.map((k) => {
        const v = macros[k]
        const t = target?.[k]
        const off = t ? (v - t) / Math.max(t, 1) : 0
        const cls = t === undefined ? '' : Math.abs(off) <= 0.1 ? 'ok' : Math.abs(off) <= 0.2 ? 'warn' : 'bad'
        return (
          <div key={k} className={`macro-chip ${cls}`}>
            <strong>
              {k === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10}
              {MACRO_UNITS[k] === 'g' ? ' g' : ' kcal'}
            </strong>
            <span>
              {MACRO_LABELS[k]}
              {t !== undefined ? ` / ${k === 'kcal' ? Math.round(t) : Math.round(t)}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
