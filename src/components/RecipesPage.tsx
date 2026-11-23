import { useState } from 'react'
import { useStore } from '../store'
import { RecipeView } from './RecipeView'

export function RecipesPage() {
  const { state, update } = useStore()
  const [open, setOpen] = useState<string | null>(null)

  if (state.recipes.length === 0) {
    return (
      <div className="page">
        <section className="card">
          <h2>Saved recipes</h2>
          <p className="hint">Recipes you save from the planner show up here.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      {state.recipes.map((r) => (
        <section key={r.id} className="card">
          {open === r.id ? (
            <>
              <RecipeView recipe={r} />
              <div className="row">
                <button type="button" className="secondary" onClick={() => setOpen(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => confirm(`Delete "${r.title}"?`) && update((s) => ({ ...s, recipes: s.recipes.filter((x) => x.id !== r.id) }))}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="recipe-row" onClick={() => setOpen(r.id)}>
              <strong>{r.title}</strong>
              <span className="hint">
                {Math.round(r.totals.kcal)} kcal · P {Math.round(r.totals.protein)} · C {Math.round(r.totals.carbs)} · F {Math.round(r.totals.fat)} ·{' '}
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </button>
          )}
        </section>
      ))}
    </div>
  )
}
