import { useStore } from '../store'
import { type Stock, STOCK_LABEL, type Ware } from '../types'
import { StockControl } from './StockControl'

interface Props {
  food: Ware
  /** Opens the editor; without it the name is not a button. */
  onOpen?: () => void
  /** The food has moved to another group while the row stays in its old one; the row then says where it went. */
  moved?: boolean
}

/** One food with its macros and a stock control. */
export function FoodRow({ food, onOpen, moved }: Props) {
  const { update } = useStore()
  const setStock = (stock: Stock) => update((s) => ({ ...s, wares: s.wares.map((w) => (w.id === food.id ? { ...w, stock } : w)) }))
  const label = (
    <>
      <span className="food-name">
        {food.name}
        {food.brand ? <small> · {food.brand}</small> : null}
        {moved && <span className="tag moved">moved to {STOCK_LABEL[food.stock]}</span>}
      </span>
      <span className="food-macros">
        P {food.per100.protein} · C {food.per100.carbs} · F {food.per100.fat} · {food.per100.kcal} kcal
      </span>
    </>
  )
  return (
    <li className={moved ? 'food moved' : 'food'}>
      {onOpen ? (
        <button type="button" className="food-main" onClick={onOpen}>
          {label}
        </button>
      ) : (
        <div className="food-main">{label}</div>
      )}
      <StockControl name={food.name} value={food.stock} onChange={setStock} />
    </li>
  )
}
