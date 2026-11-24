'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Flashlight, FlashlightOff, Loader2, ScanLine, X } from 'lucide-react'
import type QrScanner from 'qr-scanner'
import { transferPathFromQr } from '@/lib/transfer-qr'
import { primaryButtonClass } from '@/components/ui/form'

type State = 'idle' | 'starting' | 'scanning' | 'opening' | 'error'

/** Why the camera did not start, in words for the person holding the phone. */
function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was refused. Allow the camera for this site in the browser settings, or type the number below.'
  }
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again, or type the number below.'
  if (String(err).includes('Camera not found')) return 'No camera found on this device. Type the number below instead.'
  return 'The camera could not start. Type the number below instead.'
}

/**
 * Scan a transfer label (Week 12) and open the transfer at its count form.
 * The camera starts only when asked — the list and the search below work
 * without it — and stops when the scanner closes, the page is left, or a
 * label is recognised. Only this app's transfer links are accepted
 * (lib/transfer-qr.ts); the app opens the path itself rather than the
 * scanned text. qr-scanner is loaded on first use: it needs the browser, and
 * most visits never open the camera.
 */
export function TransferScanner({ appUrl }: { appUrl: string }) {
  const router = useRouter()
  const videoRef   = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const [state, setState]     = useState<State>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [hasFlash, setHasFlash] = useState(false)
  const [flashOn, setFlashOn]   = useState(false)

  const stop = useCallback(() => {
    scannerRef.current?.stop()
    scannerRef.current?.destroy()
    scannerRef.current = null
    setHasFlash(false)
    setFlashOn(false)
  }, [])

  // Leaving the page must release the camera (and its light on the phone).
  useEffect(() => stop, [stop])

  async function start() {
    setMessage(null)
    if (!window.isSecureContext) {
      setState('error')
      setMessage('The camera only works on a secure (https) address. Type the number below instead.')
      return
    }
    const video = videoRef.current
    if (!video) return
    setState('starting')

    const origins = [window.location.origin]
    try { origins.push(new URL(appUrl).origin) } catch { /* a malformed NEXT_PUBLIC_APP_URL: this page's own origin still works */ }

    try {
      const { default: Scanner } = await import('qr-scanner')
      let lastRejected = ''
      const scanner = new Scanner(
        video,
        result => {
          const path = transferPathFromQr(result.data, origins)
          if (path) {
            stop()
            setState('opening')
            setMessage(null)
            router.push(`${path}#receive`)
          } else if (result.data !== lastRejected) {
            // The same wrong code is read many times a second; say it once.
            lastRejected = result.data
            setMessage('That QR is not a KitchenERP transfer label. Scan the label on the box, or type the number below.')
          }
        },
        { returnDetailedScanResult: true, preferredCamera: 'environment', maxScansPerSecond: 8 },
      )
      scannerRef.current = scanner
      await scanner.start()
      setState('scanning')
      setHasFlash(await scanner.hasFlash())
    } catch (err) {
      stop()
      setState('error')
      setMessage(cameraError(err))
    }
  }

  function close() {
    stop()
    setState('idle')
    setMessage(null)
  }

  async function toggleFlash() {
    const scanner = scannerRef.current
    if (!scanner) return
    await scanner.toggleFlash()
    setFlashOn(scanner.isFlashOn())
  }

  const cameraOpen = state === 'starting' || state === 'scanning'

  return (
    <section className="mb-4">
      {/* Always in the DOM: qr-scanner needs the element before it starts. */}
      <div className={`relative overflow-hidden rounded-xl bg-gray-900 ${cameraOpen ? 'block' : 'hidden'}`}>
        <video ref={videoRef} className="aspect-square w-full object-cover sm:aspect-video" muted playsInline />
        {/* The aiming frame — decoration only; qr-scanner reads the whole picture. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="h-3/5 w-3/5 max-w-64 rounded-2xl border-2 border-white/80 sm:max-h-56" />
        </div>
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
            <Loader2 size={18} className="mr-2 animate-spin" /> Starting the camera…
          </div>
        )}
        <div className="absolute right-2 top-2 flex gap-2">
          {hasFlash && (
            <button
              type="button"
              onClick={toggleFlash}
              aria-label={flashOn ? 'Turn the light off' : 'Turn the light on'}
              className="rounded-full bg-black/50 p-2.5 text-white transition-colors hover:bg-black/70"
            >
              {flashOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close the scanner"
            className="rounded-full bg-black/50 p-2.5 text-white transition-colors hover:bg-black/70"
          >
            <X size={20} />
          </button>
        </div>
        <p className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-2 text-center text-sm text-white">
          Point the camera at the QR on the label
        </p>
      </div>

      {(state === 'idle' || state === 'error') && (
        <button type="button" onClick={start} className={`${primaryButtonClass} inline-flex w-full items-center justify-center gap-2 sm:w-auto`}>
          <ScanLine size={18} /> Scan a label
        </button>
      )}
      {state === 'opening' && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Loader2 size={16} className="animate-spin" /> Label read — opening the transfer…
        </p>
      )}
      {message && (
        <p role="alert" className={`mt-2 rounded-lg border px-3 py-2 text-sm ${state === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {message}
        </p>
      )}
    </section>
  )
}
