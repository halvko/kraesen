import { useState } from 'react'
import type { ErrorInfo } from '../claude'
import { KeyForm } from './ProfileForms'
import { Sheet } from './Sheet'

interface Props {
  error: ErrorInfo
  /** Called after a new key is saved from the sheet; the caller clears the error and moves focus on. */
  onKeySaved: () => void
  className?: string
}

/** A failed Claude call, with Fix the key and the key sheet when a different key is the fix. */
export function ClaudeError({ error, onKeySaved, className }: Props) {
  const [sheet, setSheet] = useState(false)
  return (
    <div className={className ? `error ${className}` : 'error'} role="alert">
      <p>{error.message}</p>
      {error.fixKey && (
        <button type="button" className="secondary" onClick={() => setSheet(true)}>
          Fix the key
        </button>
      )}
      {sheet && (
        <Sheet title="Claude API key" onClose={() => setSheet(false)}>
          <KeyForm
            onSaved={() => {
              setSheet(false)
              onKeySaved()
            }}
          />
        </Sheet>
      )}
    </div>
  )
}
