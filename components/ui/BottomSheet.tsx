'use client'

import { useEffect, useId, useState } from 'react'

/**
 * A panel that slides up from the bottom on a phone and sits centred on a
 * larger screen — the app-like replacement for window.confirm ("localhost
 * says…"), which cannot be styled, shows the site's address and cannot hold a
 * summary or a busy state. Escape and a tap outside close it unless
 * `dismissible` is false (while a request is in flight).
 */
export function BottomSheet({ open, onClose, title, dismissible = true, children }: {
  open: boolean
  onClose: () => void
  title: string
  dismissible?: boolean
  children: React.ReactNode
}) {
  const titleId = useId()
  // Mounted off-screen, then moved in on the next frame, so it slides rather than appears.
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!open) { setShown(false); return }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open || !dismissible) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissible, onClose])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-gray-900/50 transition-opacity duration-200 sm:items-center sm:p-6 ${shown ? 'opacity-100' : 'opacity-0'}`}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-5 pt-3 shadow-xl transition-transform duration-200 ease-out sm:max-w-md sm:rounded-2xl sm:pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
          shown ? 'translate-y-0' : 'translate-y-full sm:translate-y-4'
        }`}
      >
        {/* The grab handle — the phone cue that this is a sheet. */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden="true" />
        <h2 id={titleId} className="mb-3 text-lg font-semibold text-gray-800">{title}</h2>
        {children}
      </div>
    </div>
  )
}
