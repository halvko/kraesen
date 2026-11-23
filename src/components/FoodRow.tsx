import { useStore } from '../store'
import type { Stock, Ware } from '../types'
import { StockControl } from './StockControl'

/** One food with its macros and a stock control. Tapping the name opens the editor, when there is one. */
export function FoodRow({ food, onOpen }: { food: Ware; onOpen?: () => void }) {
  const { update } = useStore()
  const setStock = (stock: Stock) => update((s) => ({ ...s, wares: s.wares.map((w) => (w.id === food.id ? { ...w, stock } : w)) }))
  const label = (
    <>
      <span className="ware-name">
        {food.name}
        {food.brand ? <small> · {food.brand}</small> : null}
      </span>
      <span className="ware-macros">
        P {food.per100.protein} · C {food.per100.carbs} · F {food.per100.fat} · {food.per100.kcal} kcal
      </span>
    </>
  )
  return (
    <li className="ware">
      {onOpen ? (
        <button type="button" className="ware-main" onClick={onOpen}>
          {label}
        </button>
      ) : (
        <div className="ware-main">{label}</div>
      )}
      <StockControl id={food.id} name={food.name} value={food.stock} onChange={setStock} />
    </li>
  )
}
