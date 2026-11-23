import { type ReactNode, useEffect, useRef } from 'react'

/** A modal sheet that slides up from the bottom. Escape, the backdrop and Done all close it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close()
      }}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={() => ref.current?.close()}>
            Done
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
