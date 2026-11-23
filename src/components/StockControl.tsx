import { type Stock, STOCK_LABEL, STOCKS } from '../types'

/** One compact segmented control for where a food is: Home, Freezer, Shop or Not now. */
export function StockControl({ id, name, value, onChange }: { id: string; name: string; value: Stock; onChange: (s: Stock) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={`Where is ${name}?`}>
      {STOCKS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          className={value === s ? `on stock-${s}` : ''}
          data-food={id}
          data-stock={s}
          onClick={() => {
            onChange(s)
            // A change can move the row to another group, which remounts it and drops focus; put focus back on it.
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-food="${CSS.escape(id)}"][data-stock="${s}"]`)?.focus())
          }}
        >
          {STOCK_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
