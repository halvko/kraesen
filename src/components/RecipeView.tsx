import type { Recipe } from '../types'
import { MacroSummary } from './MacroInputs'

export function RecipeView({ recipe }: { recipe: Recipe }) {
  return (
    <article className="recipe">
      <h2>{recipe.title}</h2>
      {recipe.summary && <p className="summary">{recipe.summary}</p>}
      <MacroSummary macros={recipe.totals} target={recipe.target} />
      <h3>Ingredients</h3>
      <ul className="ingredients">
        {recipe.ingredients.map((i) => (
          <li key={i.wareId}>
            <span className="grams">{i.grams} g</span> {i.name}
            {i.fromBuyList && <span className="tag">buy</span>}
          </li>
        ))}
        {recipe.extras.map((e) => (
          <li key={e} className="extra">
            <span className="grams" /> {e}
          </li>
        ))}
      </ul>
      <h3>Steps</h3>
      <ol className="steps">
        {recipe.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {recipe.tips && <p className="hint">{recipe.tips}</p>}
    </article>
  )
}
