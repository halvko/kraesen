import { useState } from 'react'
import { CookPage } from './components/CookPage'
import { KitchenPage } from './components/KitchenPage'
import { RecipesPage } from './components/RecipesPage'
import { SettingsPage } from './components/SettingsPage'
import { StoreProvider } from './store'

type Tab = 'cook' | 'kitchen' | 'recipes'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'cook', label: 'Cook', icon: '🍳' },
  { id: 'kitchen', label: 'Kitchen', icon: '🥕' },
  { id: 'recipes', label: 'Recipes', icon: '📖' },
]

function Shell() {
  const [tab, setTab] = useState<Tab>('cook')
  // Settings is rarely used after setup, so it sits behind the gear rather than in the tab bar.
  const [settings, setSettings] = useState(false)
  const go = (t: Tab) => {
    setSettings(false)
    setTab(t)
  }
  return (
    <div className="app">
      <header className="topbar">
        <h1>Kraesen</h1>
        <button
          type="button"
          className={settings ? 'icon gear on' : 'icon gear'}
          aria-label="Settings"
          aria-pressed={settings}
          onClick={() => setSettings((v) => !v)}
        >
          ⚙️
        </button>
      </header>
      <main>
        {settings ? (
          <SettingsPage onClose={() => setSettings(false)} />
        ) : (
          <>
            {tab === 'cook' && <CookPage goToKitchen={() => go('kitchen')} />}
            {tab === 'kitchen' && <KitchenPage />}
            {tab === 'recipes' && <RecipesPage />}
          </>
        )}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => {
          const current = !settings && tab === t.id
          return (
            <button key={t.id} type="button" className={current ? 'active' : ''} aria-current={current ? 'page' : undefined} onClick={() => go(t.id)}>
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
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
