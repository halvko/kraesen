import { type Stock, STOCK_LABEL, STOCKS } from '../types'

/** One compact segmented control for where a food is, one segment per stock value. */
export function StockControl({ name, value, onChange }: { name: string; value: Stock; onChange: (s: Stock) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={`Where is ${name}?`}>
      {STOCKS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          className={value === s ? `on stock-${s}` : ''}
          onClick={() => onChange(s)}
        >
          {STOCK_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
