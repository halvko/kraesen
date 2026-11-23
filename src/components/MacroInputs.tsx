import { relativeDeviation } from '../solver'
import { MACRO_KEYS, MACRO_LABELS, MACRO_UNITS, type Macros, roundMacro, toNonNegative } from '../types'

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
            onChange={(e) => {
              // Typed values bypass min={0}; macros are never negative.
              onChange({ ...value, [k]: toNonNegative(e.target.value) ?? 0 })
            }}
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
        const off = t === undefined ? 0 : Math.abs(relativeDeviation(k, v, t))
        const cls = t === undefined ? '' : off <= 0.1 ? 'ok' : off <= 0.2 ? 'warn' : 'bad'
        return (
          <div key={k} className={`macro-chip ${cls}`}>
            <strong>
              {roundMacro(k, v)}
              {MACRO_UNITS[k] === 'g' ? ' g' : ' kcal'}
            </strong>
            <span>
              {MACRO_LABELS[k]}
              {t !== undefined ? ` / ${roundMacro(k, t)}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
