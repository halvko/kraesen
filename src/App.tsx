import { useState } from 'react'
import { MealPage } from './components/MealPage'
import { RecipesPage } from './components/RecipesPage'
import { SettingsPage } from './components/SettingsPage'
import { WaresPage } from './components/WaresPage'
import { StoreProvider, useStore } from './store'

type Tab = 'meal' | 'wares' | 'recipes' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'meal', label: 'Plan', icon: '🍳' },
  { id: 'wares', label: 'Wares', icon: '🥕' },
  { id: 'recipes', label: 'Recipes', icon: '📖' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

function Shell() {
  const { state } = useStore()
  const [tab, setTab] = useState<Tab>(() => (state.profile && state.settings.apiKey ? 'meal' : 'settings'))
  return (
    <div className="app">
      <header className="topbar">
        <h1>Kraesen</h1>
      </header>
      <main>
        {tab === 'meal' && <MealPage goToSettings={() => setTab('settings')} goToWares={() => setTab('wares')} />}
        {tab === 'wares' && <WaresPage />}
        {tab === 'recipes' && <RecipesPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
