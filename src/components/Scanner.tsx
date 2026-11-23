import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import { describeError, makeClient, readNutritionLabel } from '../claude'
import { lookupBarcode } from '../openfoodfacts'
import { useStore } from '../store'
import type { WareDraft } from './WareEditor'

interface Props {
  onResult: (draft: WareDraft, banner: string) => void
  onCancel: () => void
}

type Phase = 'scanning' | 'looking' | 'notfound' | 'reading' | 'duplicate'

/** Downscale a photo to keep the upload small; returns base64 JPEG without the data: prefix. */
async function toJpegBase64(file: File, maxSide = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}

export function Scanner({ onResult, onCancel }: Props) {
  const { state } = useStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  // Aborted on unmount, so a lookup or label read that finishes after Cancel
  // neither reopens the editor nor keeps a Claude request running.
  const abortRef = useRef(new AbortController())
  const [phase, setPhase] = useState<Phase>('scanning')
  const [barcode, setBarcode] = useState('')
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')

  useEffect(() => {
    const ac = abortRef.current
    return () => ac.abort()
  }, [])

  const handleCode = async (code: string) => {
    controlsRef.current?.stop()
    const signal = abortRef.current.signal
    const existing = state.wares.find((w) => w.barcode === code)
    if (existing) {
      setBarcode(code)
      setError(`You already have "${existing.name}" with barcode ${code}. Edit it in the list instead.`)
      setPhase('duplicate')
      return
    }
    setBarcode(code)
    setPhase('looking')
    setError('')
    try {
      const p = await lookupBarcode(code, signal)
      if (signal.aborted) return
      if (p) {
        onResult(
          { name: p.name, brand: p.brand ?? '', barcode: p.barcode, source: 'openfoodfacts', per100: p.per100, list: 'have', status: 'available' },
          p.incomplete
            ? 'Found in Open Food Facts, but some values were missing and set to 0. Please check them against the label.'
            : 'Found in Open Food Facts. Check the numbers before saving.',
        )
        return
      }
      setPhase('notfound')
    } catch (e) {
      if (signal.aborted) return
      setError(`Lookup failed: ${describeError(e)}`)
      setPhase('notfound')
    }
  }

  // The camera starts when scanning begins and stops when it ends; handleCode is
  // read through a ref so a re-render does not restart the camera.
  const handleCodeRef = useRef(handleCode)
  useEffect(() => {
    handleCodeRef.current = handleCode
  })

  useEffect(() => {
    if (phase !== 'scanning') return
    const reader = new BrowserMultiFormatReader()
    let done = false
    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current!, (result, _err, controls) => {
        controlsRef.current = controls
        if (result && !done) {
          done = true
          handleCodeRef.current(result.getText())
        }
      })
      .then((controls) => {
        controlsRef.current = controls
        if (done) controls.stop()
      })
      .catch((e) => setCameraError(`Camera unavailable: ${e instanceof Error ? e.message : e}. Type the barcode instead.`))
    return () => {
      done = true
      controlsRef.current?.stop()
    }
  }, [phase])

  const onPhoto = async (file: File) => {
    if (!state.settings.apiKey) {
      setError('Add your Claude API key in Settings to read labels.')
      return
    }
    const signal = abortRef.current.signal
    setPhase('reading')
    setError('')
    try {
      const data = await toJpegBase64(file)
      const r = await readNutritionLabel(makeClient(state.settings.apiKey), state.settings.model, data, 'image/jpeg', signal)
      if (signal.aborted) return
      if (!r.readable) {
        setError('Claude could not find a nutrition table in that photo. Try again closer and in good light.')
        setPhase('notfound')
        return
      }
      onResult(
        { name: r.name || '', brand: r.brand || '', barcode: barcode || undefined, source: 'label', per100: r.per100, list: 'have', status: 'available' },
        `Read from your photo by Claude. ${r.basis_note} Please confirm or correct every number before saving.`,
      )
    } catch (e) {
      if (signal.aborted) return
      setError(describeError(e))
      setPhase('notfound')
    }
  }

  return (
    <div className="card">
      <h2>Scan a ware</h2>
      {phase === 'scanning' && (
        <>
          {cameraError ? (
            <p className="banner">{cameraError}</p>
          ) : (
            <>
              <video ref={videoRef} className="scanner-video" muted playsInline />
              <p className="hint">Point the camera at the barcode.</p>
            </>
          )}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (manual.trim()) handleCode(manual.trim())
            }}
          >
            <input inputMode="numeric" placeholder="…or type the barcode" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Barcode" />
            <button type="submit" className="secondary">
              Look up
            </button>
          </form>
        </>
      )}
      {phase === 'looking' && <p role="status">Looking up {barcode} in Open Food Facts…</p>}
      {phase === 'reading' && <p role="status">Claude is reading the label…</p>}
      {phase === 'notfound' && (
        <>
          <p>
            {barcode ? `Barcode ${barcode} was not found in Open Food Facts.` : 'No barcode.'} Take a photo of the nutrition label
            and Claude will read the values for you to check.
          </p>
          <div className="row">
            <button type="button" onClick={() => fileRef.current?.click()}>
              Photograph label
            </button>
            <button type="button" className="secondary" onClick={() => setPhase('scanning')}>
              Scan again
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPhoto(f)
              e.target.value = ''
            }}
          />
        </>
      )}
      {phase === 'duplicate' && (
        <button type="button" className="secondary" onClick={() => setPhase('scanning')}>
          Scan another
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
