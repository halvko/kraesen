import { useRef, useState } from 'react'
import { exportJson, importJson } from '../persist'
import { useStore } from '../store'
import { GoalsForm, KeyForm, RulesForm } from './ProfileForms'

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const { state, replace } = useStore()
  const [message, setMessage] = useState('')
  // Remounts the forms after an import so they show the imported values.
  const [generation, setGeneration] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const download = () => {
    const blob = new Blob([exportJson(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kraesen-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImport = async (file: File) => {
    try {
      const next = importJson(await file.text(), state)
      if (!confirm(`Replace all data on this device with ${next.wares.length} foods and ${next.recipes.length} recipes from the file?`)) return
      replace(next)
      setGeneration((g) => g + 1)
      setMessage('Imported.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  return (
    <div className="page" key={generation}>
      <div className="row page-head">
        <h2>Settings</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <section className="card" id="goals">
        <h2>Daily goals</h2>
        <GoalsForm />
      </section>

      <section className="card" id="rules">
        <h2>Food rules</h2>
        <RulesForm />
      </section>

      <section className="card" id="key">
        <h2>Claude API key</h2>
        <KeyForm />
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="hint">Everything lives on this device only. Export a JSON file now and then; the API key is never included.</p>
        <div className="row">
          <button type="button" className="secondary" onClick={download}>
            Export JSON
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </div>
        {message && <p className="hint">{message}</p>}
      </section>
    </div>
  )
}
